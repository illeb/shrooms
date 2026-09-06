import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Attribuisce provincia e regione alle stazioni a partire dalle coordinate.
 *
 * Serve perche' Arpae non pubblica la provincia, e perche' l'adapter marca come
 * Emilia-Romagna tutta la sua rete - inclusa qualche stazione di crinale che
 * cade in Liguria o Toscana. Un punto dentro un poligono e' piu' affidabile di
 * un'etichetta ereditata dalla sorgente.
 *
 * Confini da openpolis/geojson-italy, che ripubblica i limiti ISTAT.
 */
@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);

  private static readonly BOUNDARIES_URL =
    'https://raw.githubusercontent.com/openpolis/geojson-italy/master/geojson/limits_IT_provinces.geojson';

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Scarica e carica i confini provinciali. Idempotente. */
  async importBoundaries(): Promise<number> {
    const response = await fetch(GeocodingService.BOUNDARIES_URL);
    if (!response.ok) {
      throw new Error(`Confini non scaricabili: HTTP ${response.status}`);
    }

    const collection = (await response.json()) as FeatureCollection;
    let imported = 0;

    for (const feature of collection.features ?? []) {
      const p = feature.properties;
      if (!p?.prov_acr || !p.prov_name || !feature.geometry) continue;

      // ST_Multi normalizza: il dataset mescola Polygon e MultiPolygon, la
      // colonna ne accetta uno solo.
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO "province_boundary" ("acronym", "name", "region", "istatCode", "geom")
         VALUES ($1, $2, $3, $4, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($5), 4326)))
         ON CONFLICT ("acronym") DO UPDATE SET
           "name" = EXCLUDED."name",
           "region" = EXCLUDED."region",
           "istatCode" = EXCLUDED."istatCode",
           "geom" = EXCLUDED."geom",
           "importedAt" = now()`,
        p.prov_acr,
        p.prov_name,
        p.reg_name ?? '',
        p.prov_istat_code ?? '',
        JSON.stringify(feature.geometry),
      );
      imported += 1;
    }

    this.logger.log(`${imported} confini provinciali caricati.`);
    return imported;
  }

  /**
   * Assegna provincia e regione a ogni stazione per contenimento nel poligono.
   *
   * Le stazioni appena fuori dai confini (isole di coordinate imprecise, punti
   * sul mare o oltre il crinale) ricadono sulla provincia piu' vicina entro
   * 5 km, invece di restare senza. Oltre, meglio ammettere di non saperlo.
   */
  async assignProvinces(): Promise<{ contained: number; nearest: number; unresolved: number }> {
    const contained = await this.prisma.$executeRawUnsafe(`
      UPDATE "station" s SET
        "province"     = b."acronym",
        "provinceName" = b."name",
        "region"       = b."region",
        "updatedAt"    = now()
      FROM "province_boundary" b
      WHERE ST_Contains(b."geom", ST_SetSRID(ST_MakePoint(s."longitude", s."latitude"), 4326))
    `);

    // La LATERAL non puo' riferirsi alla tabella target di un UPDATE: le
    // stazioni entrano nella sottoquery, che poi si riaggancia per id.
    const nearest = await this.prisma.$executeRawUnsafe(`
      UPDATE "station" s SET
        "province"     = n."acronym",
        "provinceName" = n."name",
        "region"       = n."region",
        "updatedAt"    = now()
      FROM (
        SELECT st."id" AS station_id, b."acronym", b."name", b."region"
        FROM "station" st
        CROSS JOIN LATERAL (
          SELECT p."acronym", p."name", p."region"
          FROM "province_boundary" p
          WHERE ST_DWithin(
            p."geom"::geography,
            ST_SetSRID(ST_MakePoint(st."longitude", st."latitude"), 4326)::geography,
            5000
          )
          ORDER BY p."geom" <-> ST_SetSRID(ST_MakePoint(st."longitude", st."latitude"), 4326)
          LIMIT 1
        ) b
        WHERE st."province" IS NULL
      ) n
      WHERE s."id" = n.station_id
    `);

    const unresolved = await this.prisma.station.count({ where: { province: null } });

    return { contained, nearest, unresolved };
  }
}

interface FeatureCollection {
  features?: Array<{
    properties?: {
      prov_acr?: string;
      prov_name?: string;
      reg_name?: string;
      prov_istat_code?: string;
    };
    geometry?: unknown;
  }>;
}
