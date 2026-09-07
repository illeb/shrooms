import { Inject } from '@nestjs/common';
import { Field, Int, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { PrismaService } from '../../prisma/prisma.service';

@ObjectType({ description: 'Una regione con quanto ci sta dentro.' })
export class RegionCountType {
  @Field(() => String) region!: string;

  @Field(() => Int, { description: 'Stazioni meteo osservate.' })
  stations!: number;

  @Field(() => Int, { description: 'Celle di bosco.' })
  cells!: number;
}

/**
 * L'elenco delle regioni coperte, dal dato e non da una costante.
 *
 * Scritta a mano, questa lista sarebbe invecchiata al primo ampliamento: fino
 * a stamattina c'era solo l'Emilia-Romagna. Cosi' una regione appare nei
 * filtri appena arrivano le sue celle, e sparisce se le si cancella.
 *
 * Le regioni di confine ci sono con i loro numeri piccoli - un pugno di celle
 * in Liguria, in Umbria, nelle Marche - perche' la griglia esagonale non si
 * ferma sul confine amministrativo e nascondere quelle celle dai filtri
 * significherebbe non poterle piu' escludere.
 */
@Resolver(() => RegionCountType)
export class RegionResolver {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Query(() => [RegionCountType], {
    description: 'Regioni coperte, con quante stazioni e quante celle ognuna.',
  })
  async regions(): Promise<RegionCountType[]> {
    return this.prisma.$queryRawUnsafe<RegionCountType[]>(`
      SELECT "region",
             count(*) FILTER (WHERE "network" IS DISTINCT FROM 'bosco')::int AS "stations",
             count(*) FILTER (WHERE "network" = 'bosco')::int AS "cells"
      FROM "station"
      WHERE "active" AND "region" IS NOT NULL
      GROUP BY "region"
      ORDER BY count(*) DESC, "region" ASC
    `);
  }
}
