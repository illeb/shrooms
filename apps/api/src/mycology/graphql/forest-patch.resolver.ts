import { Inject } from '@nestjs/common';
import { Args, Field, Float, ID, InputType, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { IsIn, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';

const FOREST_TYPES = [
  'FAGGETA',
  'CASTAGNETO',
  'CERRETA',
  'QUERCETO',
  'ORNO_OSTRIETO',
  'LECCETA',
  'CONIFERE',
  'MISTO',
  'ALTRO',
] as const;

@ObjectType({ description: 'Una cella di bosco, senza previsioni: solo che bosco e’.' })
export class ForestPatchType {
  @Field(() => ID) id!: string;
  @Field(() => String) code!: string;

  @Field(() => Float) latitude!: number;
  @Field(() => Float) longitude!: number;
  @Field(() => Float, { description: 'Quota del centro cella, m s.l.m.' }) altitudeM!: number;

  @Field(() => String, { description: FOREST_TYPES.join(' | ') }) forestType!: string;

  @Field(() => String, {
    description: 'Tipo forestale e specie prevalente come li scrive la carta regionale.',
  })
  forestLabel!: string;

  @Field(() => String, { description: 'Codice del tipo forestale nella carta regionale.' })
  forestCode!: string;

  @Field(() => Float, {
    nullable: true,
    description: "Quanta parte dell'esagono e’ davvero bosco, 0..1.",
  })
  forestFraction!: number | null;

  @Field(() => String, {
    nullable: true,
    description: 'Governo del bosco: ceduo, fustaia, ceduo in conversione.',
  })
  management!: string | null;

  @Field(() => String, { nullable: true }) province!: string | null;
  @Field(() => String, { nullable: true }) provinceName!: string | null;
  @Field(() => String, { nullable: true }) region!: string | null;

  @Field(() => String, { description: "Geometria dell'esagono, GeoJSON serializzato." })
  geoJson!: string;
}

@InputType()
export class ForestPatchesInput {
  @Field(() => [String], { nullable: true, description: 'Tipi da includere. Vuoto = tutti.' })
  @IsOptional()
  @IsIn(FOREST_TYPES, { each: true })
  forestTypes?: string[];

  @Field(() => [String], {
    nullable: true,
    description: 'Regioni da includere, per nome ("Toscana"). Vuoto = tutte.',
  })
  @IsOptional()
  @IsString({ each: true })
  regions?: string[];

  @Field(() => Float, { nullable: true }) @IsOptional() @IsNumber() minAltitudeM?: number;
  @Field(() => Float, { nullable: true }) @IsOptional() @IsNumber() maxAltitudeM?: number;

  @Field(() => Float, {
    nullable: true,
    defaultValue: 0,
    description:
      "Frazione boscata minima, 0..1. Alzarla lascia solo il bosco pieno e " +
      'toglie le celle a mosaico con prati e coltivi.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  minForestFraction?: number;
}

/**
 * La carta dei tipi di bosco.
 *
 * Sono le stesse celle di `forestCells`, ma la domanda e' un'altra - **che
 * bosco c'e' qui**, non se stia buttando - e per questo non passa dal modello
 * delle specie: nessun join con le previsioni, nessuna dipendenza da un
 * modello attivo. Se domani il punteggio dei porcini sparisse, questa mappa
 * continuerebbe a funzionare, perche' la carta forestale non c'entra nulla coi
 * funghi.
 *
 * Conseguenza utile per chi disegna: qui il colore e' libero. Sulla mappa
 * delle condizioni il colore e' il punteggio e il tipo di bosco puo' essere
 * solo un filtro; qui il tipo di bosco e' il soggetto e si prende il colore.
 */
@Resolver(() => ForestPatchType)
export class ForestPatchResolver {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Query(() => [ForestPatchType], {
    description: 'Celle di bosco con tipo forestale, specie prevalente e governo.',
  })
  async forestPatches(
    @Args('input', { type: () => ForestPatchesInput, nullable: true })
    input?: ForestPatchesInput,
  ): Promise<ForestPatchType[]> {
    const types = input?.forestTypes?.length ? input.forestTypes : null;

    return this.prisma.$queryRawUnsafe<ForestPatchType[]>(
      `
      SELECT ps."id", ps."code", ps."latitude", ps."longitude", ps."altitudeM",
             ps."forestType"::text AS "forestType", ps."forestLabel", ps."forestCode",
             ps."forestFraction", ps."management",
             ps."province", ps."provinceName", ps."region",
             ST_AsGeoJSON(ps."geom") AS "geoJson"
      FROM prediction_site ps
      WHERE ($1::text[] IS NULL OR ps."forestType"::text = ANY($1::text[]))
        AND ($2::double precision IS NULL OR ps."altitudeM" >= $2)
        AND ($3::double precision IS NULL OR ps."altitudeM" <= $3)
        AND COALESCE(ps."forestFraction", 0) >= $4
        AND ($5::text[] IS NULL OR ps."region" = ANY($5::text[]))
      ORDER BY ps."altitudeM" DESC
      `,
      types,
      input?.minAltitudeM ?? null,
      input?.maxAltitudeM ?? null,
      input?.minForestFraction ?? 0,
      input?.regions?.length ? input.regions : null,
    );
  }

  /**
   * Quante celle per tipo, per la legenda e per i contatori dei filtri.
   *
   * Accetta le regioni ma non gli altri filtri: i contatori devono dire
   * quanto c'e' **entro l'area scelta**, non quanto ne resta dopo aver
   * ristretto la quota - altrimenti il numero sul pulsante cambierebbe
   * mentre lo si guarda.
   */
  @Query(() => [ForestTypeCount], {
    description: 'Conteggio delle celle per tipo di bosco, con quota media.',
  })
  async forestTypeCounts(
    @Args('regions', { type: () => [String], nullable: true })
    regions?: string[],
  ): Promise<ForestTypeCount[]> {
    return this.prisma.$queryRawUnsafe<ForestTypeCount[]>(
      `
      SELECT "forestType"::text AS "forestType",
             count(*)::int AS "cells",
             avg("altitudeM")::double precision AS "meanAltitudeM",
             min("altitudeM")::double precision AS "minAltitudeM",
             max("altitudeM")::double precision AS "maxAltitudeM"
      FROM prediction_site
      WHERE ($1::text[] IS NULL OR "region" = ANY($1::text[]))
      GROUP BY 1
      ORDER BY count(*) DESC
      `,
      regions?.length ? regions : null,
    );
  }
}

@ObjectType({ description: 'Quante celle di un tipo di bosco, e in che fascia di quota.' })
export class ForestTypeCount {
  @Field(() => String) forestType!: string;
  @Field(() => Float) cells!: number;
  @Field(() => Float) meanAltitudeM!: number;
  @Field(() => Float) minAltitudeM!: number;
  @Field(() => Float) maxAltitudeM!: number;
}
