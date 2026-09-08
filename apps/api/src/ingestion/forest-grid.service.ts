import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { fetchOpenMeteo, sleep } from './adapters/open-meteo/open-meteo-http';
import type { ForestMapSource, ForestType } from '../generated/prisma/enums.ts';

/**
 * Genera le celle di bosco su cui si calcola la previsione.
 *
 * Il punto di tutto: le stazioni stanno dove qualcuno ha messo un termometro,
 * di solito a fondovalle e in paese; i porcini stanno nel bosco, in quota, sui
 * versanti. Fra le 188 stazioni della fascia, solo 31 superano i 900 m.
 *
 * Tre passaggi, nell'ordine che costa meno:
 *
 *  1. **Esagoni** generati da PostGIS sul riquadro appenninico.
 *  2. **Tipo di bosco** dalla Carta forestale regionale 2025 gia' a database,
 *     per dominanza di area. Prima campionavo un punto via WMS - otto secondi
 *     a interrogazione, e un solo punto a decidere per nove chilometri
 *     quadrati; ora e' una query PostGIS su tutte le celle insieme.
 *  3. **Quota** dall'API elevation di Open-Meteo, 100 coordinate per chiamata.
 *
 * Il filtro forestale viene prima di quello di quota anche se e' il piu'
 * selettivo dei due solo per meta': e' locale e gratuito, mentre la quota
 * costa chiamate a un servizio a quota giornaliera. Su tutto l'Appennino sono
 * cinquemila esagoni candidati, e chiedere la quota di quelli che il bosco
 * scarterebbe comunque significa spendere la quota per buttarla via - il modo
 * in cui questo comando falliva su bbox regionali.
 */
@Injectable()
export class ForestGridService {
  private readonly logger = new Logger(ForestGridService.name);

  private static readonly ELEVATION_API = 'https://api.open-meteo.com/v1/elevation';
  /** L'API accetta 100 coordinate per chiamata. */
  private static readonly ELEVATION_CHUNK = 100;

  /** Esagoni per query di classificazione. */
  private static readonly CLASSIFY_BATCH = 500;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Costruisce le celle e le rispettive stazioni gemelle.
   *
   * Idempotente sul codice della cella: rilanciare aggiorna invece di duplicare.
   */
  async generate(options: {
    bbox: [number, number, number, number];
    cellKm: number;
    minAltitudeM: number;
    maxAltitudeM: number;
    limit?: number;
  }): Promise<{ candidates: number; forest: number; inAltitude: number; written: number }> {
    const polygons = await this.prisma.forestPolygon.count();
    if (polygons === 0) {
      throw new Error(
        'Carta forestale non caricata: esegui prima `cli forest:import`. ' +
          'Senza, non c’e’ nulla con cui classificare le celle.',
      );
    }

    const cells = await this.hexGrid(options.bbox, options.cellKm);
    this.logger.log(`Griglia: ${cells.length} celle candidate`);

    const forest = await this.classifyForest(cells);
    this.logger.log(`Bosco: ${forest.length} celle boscate su ${cells.length}`);

    const targets = options.limit ? forest.slice(0, options.limit) : forest;
    const withAltitude = await this.addElevation(targets);
    const inBand = withAltitude.filter(
      (c) => c.altitudeM >= options.minAltitudeM && c.altitudeM <= options.maxAltitudeM,
    );
    this.logger.log(
      `Quota ${options.minAltitudeM}-${options.maxAltitudeM} m: ${inBand.length} celle restano`,
    );

    let written = 0;
    for (const cell of inBand) written += await this.upsert(cell);

    await this.linkNearestStations();
    return {
      candidates: cells.length,
      forest: forest.length,
      inAltitude: inBand.length,
      written,
    };
  }

  /**
   * Esagoni da PostGIS.
   *
   * `ST_HexagonGrid` lavora in metri, quindi si genera in Web Mercator e si
   * riproietta: in gradi gli esagoni verrebbero schiacciati salendo di latitudine.
   */
  private async hexGrid(bbox: [number, number, number, number], cellKm: number): Promise<Cell[]> {
    const [south, west, north, east] = bbox;
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ lat: number; lon: number; wkt: string }>
    >(
      `
      SELECT ST_Y(c.centroid) AS lat, ST_X(c.centroid) AS lon, ST_AsText(c.hex) AS wkt
      FROM (
        SELECT ST_Transform(h.geom, 4326) AS hex,
               ST_Transform(ST_Centroid(h.geom), 4326) AS centroid
        FROM ST_HexagonGrid(
          $1::double precision,
          ST_Transform(ST_MakeEnvelope($2, $3, $4, $5, 4326), 3857)
        ) AS h
      ) c
      `,
      (cellKm * 1000) / Math.sqrt(3),
      west,
      south,
      east,
      north,
    );
    return rows.map((r) => ({ lat: r.lat, lon: r.lon, wkt: r.wkt }));
  }

  /**
   * Quota del centro di ogni cella, dal DEM di Open-Meteo.
   *
   * Stesso contatore dell'API meteo, quindi stesso backoff: il limite al
   * minuto passa aspettando, quello giornaliero no.
   */
  private async addElevation(cells: ForestCell[]): Promise<SiteCell[]> {
    const out: SiteCell[] = [];
    const chunks = Math.ceil(cells.length / ForestGridService.ELEVATION_CHUNK);

    for (let i = 0; i < cells.length; i += ForestGridService.ELEVATION_CHUNK) {
      const chunk = cells.slice(i, i + ForestGridService.ELEVATION_CHUNK);
      const url =
        `${ForestGridService.ELEVATION_API}?latitude=${chunk.map((c) => c.lat.toFixed(4)).join(',')}` +
        `&longitude=${chunk.map((c) => c.lon.toFixed(4)).join(',')}`;

      const n = Math.floor(i / ForestGridService.ELEVATION_CHUNK) + 1;
      this.logger.debug(`Quota ${n}/${chunks}: ${chunk.length} coordinate`);

      // Si tiene quello che si e' ottenuto invece di perdere tutto.
      //
      // L'API elevation condivide il contatore con quella meteo, e su una
      // regione intera sono decine di chiamate: incontrare un limite a meta'
      // e' la norma, non l'eccezione. Prima l'eccezione risaliva fino al
      // comando e buttava via anche i quarantatre secondi di classificazione
      // e tutte le celle gia' quotate; ora le celle raggiunte vengono salvate
      // e un rilancio riprende da dove si era fermato - l'upsert e' idempotente
      // e la classificazione deterministica, quindi ripetere non duplica.
      let payload: { elevation?: number[] };
      try {
        payload = await fetchOpenMeteo<{ elevation?: number[] }>(url, 'elevation', this.logger);
      } catch (error) {
        this.logger.warn(
          `Quote interrotte dopo ${n - 1}/${chunks} richieste: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
        this.logger.warn(
          `${out.length} celle quotate su ${cells.length}: rilancia lo stesso ` +
            `comando per completare le restanti.`,
        );
        return out;
      }

      chunk.forEach((cell, j) => {
        const e = payload.elevation?.[j];
        if (typeof e === 'number' && Number.isFinite(e)) out.push({ ...cell, altitudeM: e });
      });

      await sleep(300);
    }

    return out;
  }

  /**
   * Tipo di bosco dominante **per area** in ogni cella.
   *
   * Una sola query per tutte le celle: si misura quanta area di ogni tipo
   * forestale cade davvero dentro l'esagono e vince la piu' estesa.
   *
   * In piu' si ottiene la **frazione boscata** della cella, che un campione
   * puntuale non poteva dare: un esagono coperto all'80% da faggeta e' una
   * scommessa diversa da uno coperto al 15%.
   */
  private async classifyForest(cells: Cell[]): Promise<ForestCell[]> {
    const out: ForestCell[] = [];

    // A blocchi: su tutto l'Appennino sono cinquemila esagoni, e passarli in
    // un solo parametro vorrebbe dire un megabyte di WKT per query.
    for (let i = 0; i < cells.length; i += ForestGridService.CLASSIFY_BATCH) {
      const batch = cells.slice(i, i + ForestGridService.CLASSIFY_BATCH);
      out.push(...(await this.classifyBatch(batch)));
    }

    return out;
  }

  private async classifyBatch(cells: Cell[]): Promise<ForestCell[]> {
    if (cells.length === 0) return [];

    const rows = await this.prisma.$queryRawUnsafe<ClassifiedRow[]>(
      `
      WITH cells AS (
        SELECT i AS idx, ST_SetSRID(ST_GeomFromText(w), 4326) AS geom
        FROM unnest($1::int[], $2::text[]) AS t(i, w)
      )
      SELECT c.idx, best."source",
             best."typeCode", best."typeName", best."speciesName", best."management",
             (best.wooded / NULLIF(ST_Area(c.geom::geography), 0))::double precision
               AS "forestFraction"
      FROM cells c
      CROSS JOIN LATERAL (
        SELECT fp."source"::text AS "source",
               fp."typeCode", fp."typeName", fp."speciesName", fp."management",
               SUM(ST_Area(ST_Intersection(fp.geom, c.geom)::geography)) AS wooded
        FROM forest_polygon fp
        WHERE ST_Intersects(fp.geom, c.geom)
        GROUP BY fp."source", fp."typeCode", fp."typeName", fp."speciesName", fp."management"
        ORDER BY SUM(ST_Area(ST_Intersection(fp.geom, c.geom)::geography)) DESC
        LIMIT 1
      ) best
      `,
      cells.map((_, i) => i),
      cells.map((c) => c.wkt),
    );

    const out: ForestCell[] = [];
    for (const r of rows) {
      const cell = cells[r.idx];
      if (!cell) continue;

      const type = toForestType(r.typeName);
      const fraction = r.forestFraction ?? 0;

      // I boschi che non fanno porcini non meritano una cella - robinieti,
      // pioppeti, arbusteti - e nemmeno le celle boscate solo di striscio.
      if (type === 'ALTRO' || fraction < MIN_FOREST_FRACTION) continue;

      out.push({
        ...cell,
        forestSource: r.source,
        forestCode: r.typeCode,
        forestLabel: label(r.typeName, r.speciesName),
        forestType: type,
        forestFraction: Math.round(fraction * 100) / 100,
        management: r.management,
      });
    }

    return out;
  }

  /** Crea la stazione gemella e la cella. */
  private async upsert(cell: SiteCell): Promise<number> {
    const code = `bosco:${cell.lat.toFixed(4)}:${cell.lon.toFixed(4)}`;

    const station = await this.prisma.station.upsert({
      where: { source_externalId: { source: 'OPEN_METEO', externalId: code } },
      create: {
        source: 'OPEN_METEO',
        externalId: code,
        name: `${labelOf(cell.forestType)} ${Math.round(cell.altitudeM)} m`,
        network: 'bosco',
        latitude: cell.lat,
        longitude: cell.lon,
        altitudeM: cell.altitudeM,
      },
      update: {
        name: `${labelOf(cell.forestType)} ${Math.round(cell.altitudeM)} m`,
        latitude: cell.lat,
        longitude: cell.lon,
        altitudeM: cell.altitudeM,
      },
      select: { id: true },
    });

    await this.prisma.$executeRawUnsafe(
      `
      INSERT INTO "prediction_site" (
        "code","latitude","longitude","altitudeM","forestType","forestCode",
        "forestLabel","forestFraction","management","forestSource","stationId","geom"
      )
      VALUES ($1,$2,$3,$4,$5::"ForestType",$6,$7,$8,$9,$10::"ForestMapSource",$11::uuid,
              ST_SetSRID(ST_GeomFromText($12), 4326))
      ON CONFLICT ("code") DO UPDATE SET
        "altitudeM"      = EXCLUDED."altitudeM",
        "forestType"     = EXCLUDED."forestType",
        "forestCode"     = EXCLUDED."forestCode",
        "forestLabel"    = EXCLUDED."forestLabel",
        "forestFraction" = EXCLUDED."forestFraction",
        "management"     = EXCLUDED."management",
        "forestSource"   = EXCLUDED."forestSource",
        "geom"           = EXCLUDED."geom"
      `,
      code,
      cell.lat,
      cell.lon,
      cell.altitudeM,
      cell.forestType,
      cell.forestCode,
      cell.forestLabel,
      cell.forestFraction,
      cell.management,
      cell.forestSource,
      station.id,
      cell.wkt,
    );
    return 1;
  }

  /** Provincia dai confini gia' caricati, e distanza dalla stazione osservata piu' vicina. */
  private async linkNearestStations(): Promise<void> {
    await this.prisma.$executeRawUnsafe(`
      UPDATE "prediction_site" s SET
        "province" = b."acronym", "provinceName" = b."name", "region" = b."region"
      FROM "province_boundary" b
      WHERE ST_Contains(b."geom", ST_SetSRID(ST_MakePoint(s."longitude", s."latitude"), 4326))
    `);

    // La stessa collocazione va anche sulla stazione gemella. Non e' una
    // ridondanza inutile: le viste che elencano stazioni leggono da li', e una
    // cella con la regione solo sul sito resterebbe fuori da ogni filtro
    // geografico pur essendo in mezzo all'Appennino.
    await this.prisma.$executeRawUnsafe(`
      UPDATE "station" st SET
        "province" = ps."province", "region" = ps."region"
      FROM "prediction_site" ps
      WHERE ps."stationId" = st."id"
        AND (st."region" IS DISTINCT FROM ps."region"
             OR st."province" IS DISTINCT FROM ps."province")
    `);

    await this.prisma.$executeRawUnsafe(`
      UPDATE "prediction_site" s SET "nearestStationKm" = n.km
      FROM (
        SELECT ps."id",
               (SELECT min(ST_Distance(
                  ST_SetSRID(ST_MakePoint(ps."longitude", ps."latitude"),4326)::geography,
                  ST_SetSRID(ST_MakePoint(st."longitude", st."latitude"),4326)::geography)) / 1000
                FROM "station" st
                WHERE st."source" <> 'OPEN_METEO' AND st."active") AS km
        FROM "prediction_site" ps
      ) n
      WHERE s."id" = n."id"
    `);
  }
}

/** Sotto questa frazione boscata la cella e' bosco solo di striscio. */
const MIN_FOREST_FRACTION = 0.15;

interface Cell {
  lat: number;
  lon: number;
  wkt: string;
}

interface ForestCell extends Cell {
  forestSource: ForestMapSource;
  forestCode: string;
  forestLabel: string;
  forestType: ForestType;
  /** Quanta parte dell'esagono e' effettivamente bosco, 0..1. */
  forestFraction: number;
  management: string | null;
}

/** Una cella pronta da salvare: ha bosco e quota. */
interface SiteCell extends ForestCell {
  altitudeM: number;
}

interface ClassifiedRow {
  idx: number;
  source: ForestMapSource;
  typeCode: string;
  typeName: string;
  speciesName: string | null;
  management: string | null;
  forestFraction: number | null;
}

/**
 * Dal tipo forestale della carta regionale al nostro enum.
 *
 * Sul nome e non sul codice: i codici sono granulari (FA10X, FA20X... per le
 * varie faggete) mentre il nome del tipo e' gia' il livello a cui ragiona un
 * cercatore.
 */
export function toForestType(typeName: string): ForestType {
  const n = typeName.toLowerCase();

  // Le sempreverdi mediterranee prima di tutto: una "Lecceta costiera su
  // dune" non deve finire fra i querceti solo perche' il leccio e' una
  // quercia. Le sugherete stanno con loro - Quercus suber e Q. ilex sono la
  // stessa gilda sclerofilla e ospitano lo stesso porcino - e il nome vero
  // resta comunque scritto in `forestLabel`.
  if (n.includes('leccet') || n.includes('sugheret')) return 'LECCETA';

  if (n.includes('fagget')) return 'FAGGETA';
  if (n.includes('castagn')) return 'CASTAGNETO';
  if (n.includes('cerret')) return 'CERRETA';
  if (n.includes('ostriet')) return 'ORNO_OSTRIETO';

  if (
    n.includes('pinet') ||
    n.includes('abetin') ||
    n.includes('cipresset') ||
    n.includes('douglas') ||
    n.includes('rimboschiment') ||
    n.includes('conifer')
  ) {
    return 'CONIFERE';
  }

  // Prima dei querceti: l'IFT ha "Boschi misti con cerro, rovere e carpino
  // bianco", che e' un bosco misto e non un querceto, e la parola "rovere"
  // lo dirotterebbe.
  if (n.includes('mist')) return 'MISTO';

  if (
    n.includes('roverella') ||
    n.includes('quercet') ||
    n.includes('rovere') ||
    n.includes('farnia')
  ) {
    return 'QUERCETO';
  }

  // Macchie, arbusteti, robinieti, alneti, boschi ripari: bosco che non fa
  // porcini, e le celle su questi vengono scartate a monte.
  return 'ALTRO';
}

/**
 * "Faggete — Fagus sylvatica".
 *
 * La carta scrive la specie come "Fagus sylvatica - Faggio", latino piu' nome
 * volgare: il volgare e' gia' nel tipo forestale, quindi resta il binomio.
 */
function label(typeName: string, speciesName: string | null): string {
  if (!speciesName) return typeName;
  const binomial = speciesName.split(' - ')[0]?.trim();
  return binomial ? `${typeName} — ${binomial}` : typeName;
}

function labelOf(type: ForestType): string {
  const labels: Record<ForestType, string> = {
    FAGGETA: 'Faggeta',
    CASTAGNETO: 'Castagneto',
    CERRETA: 'Cerreta',
    QUERCETO: 'Querceto',
    ORNO_OSTRIETO: 'Orno-ostrieto',
    LECCETA: 'Lecceta',
    CONIFERE: 'Conifere',
    MISTO: 'Bosco misto',
    ALTRO: 'Bosco',
  };
  return labels[type];
}
