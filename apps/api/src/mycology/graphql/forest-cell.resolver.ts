import { Inject } from '@nestjs/common';
import {
  Args,
  Field,
  Float,
  ID,
  InputType,
  Int,
  ObjectType,
  Query,
  Resolver,
} from '@nestjs/graphql';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Fondo scala dei giorni dall'innesco.
 *
 * E' `incubation.maxDays` del profilo boletus-edulis: oltre quella soglia il
 * contributo dell'innesco e' zero comunque, quindi filtrare piu' in la' non
 * separerebbe piu' nulla.
 */
const MAX_DAYS_SINCE_RAIN = 28;

const FOREST_TYPES = [
  'FAGGETA',
  'CASTAGNETO',
  'CERRETA',
  'QUERCETO',
  'ORNO_OSTRIETO',
  'CONIFERE',
  'MISTO',
  'ALTRO',
] as const;

@ObjectType({ description: 'Cella di bosco con le condizioni del giorno.' })
export class ForestCellType {
  @Field(() => ID) id!: string;
  @Field(() => String) code!: string;

  @Field(() => Float) latitude!: number;
  @Field(() => Float) longitude!: number;
  @Field(() => Float, { description: 'Quota del centro cella, m s.l.m.' }) altitudeM!: number;

  @Field(() => String, { description: FOREST_TYPES.join(' | ') })
  forestType!: string;

  @Field(() => String, {
    description:
      'Tipo forestale e specie prevalente, come li scrive la carta regionale: ' +
      '"Faggete — Fagus sylvatica".',
  })
  forestLabel!: string;

  @Field(() => Float, {
    nullable: true,
    description:
      "Quanta parte dell'esagono e' davvero bosco, 0..1. Una cella boscata " +
      'per intero e una a mosaico coi prati non valgono lo stesso punteggio.',
  })
  forestFraction!: number | null;

  @Field(() => String, {
    nullable: true,
    description: 'Governo del bosco: ceduo, fustaia, ceduo in conversione.',
  })
  management!: string | null;

  @Field(() => String, { nullable: true }) province!: string | null;
  @Field(() => String, { nullable: true }) provinceName!: string | null;

  @Field(() => Float, {
    nullable: true,
    description:
      'Distanza dalla stazione osservata piu vicina, km. Dice quanta fiducia ' +
      'merita il punteggio: una cella lontana da ogni termometro e pura griglia.',
  })
  nearestStationKm!: number | null;

  @Field(() => Float, { nullable: true }) score!: number | null;
  @Field(() => String, { nullable: true }) class!: string | null;

  @Field(() => Boolean, {
    description:
      "Il punteggio non c'e' perche' la cella non ha ancora abbastanza " +
      'storico: il bilancio idrico parte da un serbatoio inventato finche' +
      "' non ha visto due mesi di pioggia vera.",
  })
  warmup!: boolean;
  @Field(() => Float, { nullable: true }) triggerScore!: number | null;
  @Field(() => Int, { nullable: true }) daysSinceWetEvent!: number | null;
  @Field(() => Float, { nullable: true }) soilWaterMm!: number | null;
  @Field(() => Float, { nullable: true }) precip21dMm!: number | null;

  @Field(() => String, { description: "Geometria dell'esagono, GeoJSON serializzato." })
  geoJson!: string;
}

@InputType()
export class ForestCellsInput {
  @Field(() => String, { nullable: true, defaultValue: 'boletus-edulis' })
  @IsOptional()
  @IsString()
  species?: string;

  @Field(() => [String], {
    nullable: true,
    description: 'Tipi di bosco da includere. Vuoto = tutti.',
  })
  @IsOptional()
  @IsIn(FOREST_TYPES, { each: true })
  forestTypes?: string[];

  @Field(() => Float, { nullable: true }) @IsOptional() @IsNumber() minAltitudeM?: number;
  @Field(() => Float, { nullable: true }) @IsOptional() @IsNumber() maxAltitudeM?: number;
  @Field(() => Float, { nullable: true, defaultValue: 0 })
  @IsOptional()
  @IsNumber()
  minScore?: number;

  @Field(() => Boolean, {
    nullable: true,
    defaultValue: false,
    description: 'Solo celle con una stazione osservata entro 5 km.',
  })
  @IsOptional()
  @IsBoolean()
  onlyNearStations?: boolean;

  @Field(() => Int, {
    nullable: true,
    description:
      "Giorni minimi dall'ultimo innesco di pioggia. Sotto l'incubazione " +
      'minima il micelio non ha ancora avuto tempo di mettere su un carpoforo.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_DAYS_SINCE_RAIN)
  minDaysSinceRain?: number;

  @Field(() => Int, {
    nullable: true,
    description:
      "Giorni massimi dall'ultimo innesco. Oltre la coda dell'incubazione " +
      'il terreno si e\' riasciugato e la buttata e\' finita.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_DAYS_SINCE_RAIN)
  maxDaysSinceRain?: number;
}

interface CellRow {
  id: string;
  code: string;
  latitude: number;
  longitude: number;
  altitudeM: number;
  forestType: string;
  forestLabel: string;
  forestFraction: number | null;
  management: string | null;
  province: string | null;
  provinceName: string | null;
  nearestStationKm: number | null;
  score: number | null;
  class: string | null;
  warmup: boolean;
  triggerScore: number | null;
  daysSinceWetEvent: number | null;
  features: Record<string, number> | null;
  geoJson: string;
}

/**
 * Le celle di bosco.
 *
 * Query in SQL grezzo e non via Prisma: serve la geometria dell'esagono in
 * GeoJSON, che Prisma non sa leggere (la colonna e' `Unsupported`), e un join
 * con il feature store per l'acqua nel suolo.
 */
@Resolver(() => ForestCellType)
export class ForestCellResolver {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Query(() => [ForestCellType], {
    description:
      'Celle di bosco con le condizioni dell ultimo giorno calcolato. ' +
      'A differenza delle stazioni, stanno dove crescono i funghi.',
  })
  async forestCells(
    @Args('input', { type: () => ForestCellsInput, nullable: true })
    input?: ForestCellsInput,
  ): Promise<ForestCellType[]> {
    const species = input?.species ?? 'boletus-edulis';

    const model = await this.prisma.speciesModel.findFirst({
      where: { species, active: true },
      select: { id: true },
    });
    if (!model) return [];

    const types = input?.forestTypes?.length ? input.forestTypes : null;

    const rows = await this.prisma.$queryRawUnsafe<CellRow[]>(
      `
      WITH ultimo AS (
        SELECT max(date) AS d FROM fruiting_prediction WHERE "modelId" = $1::uuid
      ),
      celle AS (
        SELECT ps."id", ps."code", ps."latitude", ps."longitude", ps."altitudeM",
               ps."forestType"::text AS "forestType", ps."forestLabel",
               ps."forestFraction", ps."management",
               ps."province", ps."provinceName", ps."nearestStationKm",
               COALESCE(p."warmup", false) AS "warmup",
               -- Un giorno in spin-up non e' un giudizio: meglio "non lo so"
               -- che un rosso convinto costruito su dati che non abbiamo.
               -- Il mascheramento sta qui, prima dei filtri, cosi' i filtri
               -- ragionano sugli stessi valori che poi legge il client.
               CASE WHEN p."warmup" THEN NULL ELSE p."score" END AS "score",
               CASE WHEN p."warmup" THEN NULL ELSE p."class"::text END AS "class",
               CASE WHEN p."warmup" THEN NULL ELSE p."triggerScore" END AS "triggerScore",
               CASE WHEN p."warmup" THEN NULL ELSE p."daysSinceWetEvent" END
                 AS "daysSinceWetEvent",
               f."features",
               ST_AsGeoJSON(ps."geom") AS "geoJson"
        FROM prediction_site ps
        CROSS JOIN ultimo
        LEFT JOIN fruiting_prediction p
          ON p."stationId" = ps."stationId" AND p."modelId" = $1::uuid AND p."date" = ultimo.d
        LEFT JOIN daily_station_feature f
          ON f."stationId" = ps."stationId" AND f."date" = ultimo.d
      )
      SELECT * FROM celle c
      WHERE ($2::text[] IS NULL OR c."forestType" = ANY($2::text[]))
        AND ($3::double precision IS NULL OR c."altitudeM" >= $3)
        AND ($4::double precision IS NULL OR c."altitudeM" <= $4)
        AND (COALESCE(c."score", 0) >= $5)
        AND ($6::boolean = false OR COALESCE(c."nearestStationKm", 999) <= 5)
        -- Una cella senza innesco non ha giorni da confrontare: esce appena il
        -- filtro si stringe, invece di passare per il rotto della cuffia.
        AND ($7::int IS NULL OR c."daysSinceWetEvent" >= $7)
        AND ($8::int IS NULL OR c."daysSinceWetEvent" <= $8)
      ORDER BY c."score" DESC NULLS LAST
      `,
      model.id,
      types,
      input?.minAltitudeM ?? null,
      input?.maxAltitudeM ?? null,
      input?.minScore ?? 0,
      input?.onlyNearStations ?? false,
      input?.minDaysSinceRain ?? null,
      input?.maxDaysSinceRain ?? null,
    );

    return rows.map((r) => ({
      ...r,
      soilWaterMm: numberOrNull(r.features?.['soilWaterMm']),
      precip21dMm: numberOrNull(r.features?.['p21']),
    }));
  }
}

function numberOrNull(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
