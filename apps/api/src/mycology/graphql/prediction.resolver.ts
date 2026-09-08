import { Inject } from '@nestjs/common';
import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PredictionsInput } from './prediction.input';
import { FruitingPredictionType, SpeciesModelType } from './prediction.model';

/**
 * Superficie GraphQL delle condizioni di fruttificazione.
 *
 * Volutamente magra: una lista ordinata e i metadati per interpretarla. La
 * mappa e i grafici arriveranno appoggiandosi agli stessi campi.
 */
@Resolver(() => FruitingPredictionType)
export class PredictionResolver {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Query(() => [FruitingPredictionType], {
    description:
      'Stazioni ordinate per punteggio decrescente. Senza `date` usa ' +
      "l'ultimo giorno calcolato, che e cio che serve alla domanda " +
      '"dove ci sono le condizioni adesso".',
  })
  async predictions(
    // Il tipo va dichiarato: la CLI gira con tsx, che non emette i metadati
    // dei decoratori, e senza `type` il costruttore dello schema non sa
    // dedurlo. Esplicito funziona sia sotto tsx sia sotto nest build.
    @Args('input', { type: () => PredictionsInput, nullable: true })
    input?: PredictionsInput,
  ): Promise<FruitingPredictionType[]> {
    const limit = clampLimit(input?.limit);
    const scope = await this.scope(input);
    if (!scope) return [];

    const rows = await this.prisma.fruitingPrediction.findMany({
      where: scope.where,
      orderBy: [{ score: 'desc' }, { stationId: 'asc' }],
      take: limit,
      select: {
        id: true,
        date: true,
        score: true,
        class: true,
        triggerScore: true,
        phenologyScore: true,
        daysSinceWetEvent: true,
        warmup: true,
        station: {
          select: {
            id: true,
            name: true,
            latitude: true,
            longitude: true,
            altitudeM: true,
            province: true,
            provinceName: true,
            region: true,
          },
        },
      },
    });

    // Le grandezze del suolo stanno nel feature store, non nel punteggio. Una
    // sola query in piu' invece di un ResolveField per riga: sono al massimo
    // mille stazioni, e cosi' non c'e' un N+1 da spiegare.
    const features = await this.prisma.dailyStationFeature.findMany({
      where: { date: scope.date, stationId: { in: rows.map((r) => r.station.id) } },
      select: { stationId: true, features: true },
    });

    const byStation = new Map(
      features.map((f) => [f.stationId, f.features as Record<string, number | undefined>]),
    );

    return rows.map((r) => {
      const f = byStation.get(r.station.id);
      return {
        ...r,
        date: isoDay(r.date),
        soilWaterMm: numberOrNull(f?.['soilWaterMm']),
        swi: numberOrNull(f?.['swi']),
        precip21dMm: numberOrNull(f?.['p21']),
      };
    });
  }

  @Query(() => String, {
    nullable: true,
    description: 'Ultimo giorno per cui esistono punteggi, YYYY-MM-DD.',
  })
  async latestPredictionDate(
    @Args('species', { type: () => String, nullable: true, defaultValue: 'boletus-edulis' })
    species: string,
  ): Promise<string | null> {
    const model = await this.prisma.speciesModel.findFirst({
      where: { species, active: true },
      select: { id: true },
    });
    if (!model) return null;

    const date = await this.latestDate(model.id);
    return date ? isoDay(date) : null;
  }

  @Query(() => SpeciesModelType, {
    nullable: true,
    description: 'Profilo attivo: dice con quale taratura sono stati prodotti i punteggi.',
  })
  async activeSpeciesModel(
    @Args('species', { type: () => String, nullable: true, defaultValue: 'boletus-edulis' })
    species: string,
  ): Promise<SpeciesModelType | null> {
    return this.prisma.speciesModel.findFirst({
      where: { species, active: true },
      select: { species: true, version: true, label: true, active: true },
    });
  }

  @Query(() => [SpeciesModelType], {
    description:
      'Specie per cui esiste un profilo attivo. La select del frontend si ' +
      'popola da qui: aggiungere una specie non richiede toccarlo.',
  })
  async availableSpecies(): Promise<SpeciesModelType[]> {
    return this.prisma.speciesModel.findMany({
      where: { active: true },
      select: { species: true, version: true, label: true, active: true },
      orderBy: { label: 'asc' },
    });
  }

  @Query(() => Int, {
    description:
      'Quante righe soddisfano gli stessi filtri, senza il tetto di `limit`. ' +
      'Serve alla vista per dire "1000 di 3201" invece di far passare il ' +
      'tetto della query per un totale.',
  })
  async predictionCount(
    @Args('input', { type: () => PredictionsInput, nullable: true })
    input?: PredictionsInput,
  ): Promise<number> {
    const scope = await this.scope(input);
    if (!scope) return 0;
    return this.prisma.fruitingPrediction.count({ where: scope.where });
  }

  /**
   * Il `where` condiviso da lista e conteggio.
   *
   * Uno solo e non due copie: se divergessero, la pagina direbbe "1000 di
   * 3201" contando righe che la lista non stava selezionando, ed e' il tipo di
   * bugia che nessuno nota.
   *
   * `null` quando non c'e' nulla da contare - modello inattivo o nessun giorno
   * calcolato - cosi' chi chiama distingue "zero righe" da "non si applica".
   */
  private async scope(
    input?: PredictionsInput,
  ): Promise<{ where: Prisma.FruitingPredictionWhereInput; date: Date } | null> {
    const species = input?.species ?? 'boletus-edulis';

    const model = await this.prisma.speciesModel.findFirst({
      where: { species, active: true },
      select: { id: true },
    });
    if (!model) return null;

    const date = input?.date ? parseDay(input.date) : await this.latestDate(model.id);
    if (!date) return null;

    return {
      date,
      where: {
        modelId: model.id,
        date,
        score: { gte: input?.minScore ?? 0 },
        station: {
          ...altitudeWhere(input),
          ...(input?.regions?.length ? { region: { in: input.regions } } : {}),
          ...networkWhere(input?.kind),
        },
      },
    };
  }

  private async latestDate(modelId: string): Promise<Date | null> {
    const result = await this.prisma.fruitingPrediction.aggregate({
      where: { modelId },
      _max: { date: true },
    });
    return result._max.date ?? null;
  }
}

/**
 * Stazioni osservate o celle di bosco.
 *
 * Le celle sono le stazioni sintetiche con `network = 'bosco'`, create da
 * `sites:generate`. Il default e' `stations` perche' e' cio' che le viste
 * Tabella e Mappa dicono di mostrare.
 */
function networkWhere(kind: string | undefined) {
  if (kind === 'all') return {};
  if (kind === 'cells') return { network: 'bosco' };
  return { NOT: { network: 'bosco' } };
}

function altitudeWhere(input?: PredictionsInput) {
  if (input?.minAltitudeM === undefined && input?.maxAltitudeM === undefined) return undefined;
  return {
    altitudeM: {
      ...(input.minAltitudeM === undefined ? {} : { gte: input.minAltitudeM }),
      ...(input.maxAltitudeM === undefined ? {} : { lte: input.maxAltitudeM }),
    },
  };
}

/** Limite difensivo: una query senza tetto puo' tirare giu' l'intera tabella. */
function clampLimit(limit: number | undefined): number {
  const value = limit ?? 200;
  return Math.min(Math.max(Math.trunc(value), 1), 1000);
}

function parseDay(day: string): Date {
  const date = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Data non valida: "${day}". Formato atteso YYYY-MM-DD.`);
  }
  return date;
}

function numberOrNull(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
