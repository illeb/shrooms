import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { open as openShapefile } from 'shapefile';
import { PrismaService } from '../prisma/prisma.service';
import { spawn } from 'node:child_process';
import type { ForestMapSource } from '../generated/prisma/enums.ts';

/**
 * Importa le cartografie forestali regionali.
 *
 * Due sorgenti, perche' in Italia ogni regione fa la sua e non esiste una
 * carta forestale nazionale con questo dettaglio:
 *
 *  - **Emilia-Romagna, Carta forestale 2025.** Poligoni vettoriali, specie in
 *    binomio latino, governo del bosco aggiornato. E' la carta forestale
 *    vera, non l'uso del suolo: dove quello diceva "Boschi a prevalenza di
 *    querce, carpini e castagni", questa distingue Cerrete da Boschi di
 *    Roverella da Orno-ostrieti. EPSG:7791 (RDN2008/UTM 32N).
 *
 *  - **Toscana, Inventario Forestale Toscano.** Pixel quadrati di 400 m,
 *    categoria forestale e specie prevalente col nome volgare. Rilievo
 *    1985-1993, revisione 2009: la parte che invecchia male e' il governo del
 *    bosco, che infatti non importiamo; la **categoria** invece e' la parte
 *    stabile, perche' una faggeta a 1400 metri nel 1990 e' una faggeta anche
 *    oggi. EPSG:3003 (Gauss-Boaga fuso ovest).
 *
 * La riproiezione a WGS84 la fa PostGIS in entrambi i casi, che sa gia' come
 * si fa. Cambia solo il SRID di partenza e il nome dei campi.
 */
@Injectable()
export class ForestMapService {
  private readonly logger = new Logger(ForestMapService.name);

  /** Sistema di riferimento di ogni carta, come la pubblica la regione. */
  private static readonly SRID: Record<ForestMapSource, number> = {
    /** RDN2008 / UTM zone 32N. */
    ER_2025: 7791,
    /** Monte Mario / Gauss-Boaga fuso ovest. */
    IFT_TOSCANA: 3003,
  };

  /** Poligoni per INSERT: geometrie grosse, meglio transazioni corte. */
  private static readonly BATCH = 200;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Carica tutti gli archivi `CartaForestale2025XX.zip` di una cartella.
   *
   * Idempotente su (sorgente, provincia, objectId): rilanciare aggiorna
   * invece di duplicare.
   */
  async importEmiliaRomagna(directory: string): Promise<{ files: number; polygons: number }> {
    const entries = await readdir(directory);
    const archives = entries
      .filter((f) => /^CartaForestale2025[A-Z]{2}\.zip$/i.test(f))
      .sort();

    if (archives.length === 0) {
      throw new Error(
        `Nessun archivio CartaForestale2025XX.zip trovato in ${directory}. ` +
          'Scaricali dal Sistema Informativo Forestale regionale.',
      );
    }

    let polygons = 0;
    for (const archive of archives) {
      polygons += await this.importErArchive(join(directory, archive));
    }

    this.logger.log(`${archives.length} province, ${polygons} poligoni forestali.`);
    return { files: archives.length, polygons };
  }

  private async importErArchive(zipPath: string): Promise<number> {
    const province = basename(zipPath).replace(/^CartaForestale2025/i, '').replace(/\.zip$/i, '');
    const workDir = await mkdtemp(join(tmpdir(), 'carta-forestale-'));

    try {
      await unzip(zipPath, workDir);

      const files = await readdir(workDir);
      const shp = files.find((f) => f.toLowerCase().endsWith('.shp'));
      const dbf = files.find((f) => f.toLowerCase().endsWith('.dbf'));
      if (!shp || !dbf) throw new Error(`${zipPath}: .shp o .dbf mancante`);

      const count = await this.loadShapefile(join(workDir, shp), join(workDir, dbf), (f, i) =>
        erRow(f, province, i),
      );
      this.logger.log(`${province}: ${count} poligoni`);
      return count;
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  /**
   * Carica l'Inventario Forestale Toscano da `ift.zip`.
   *
   * L'archivio pubblicato ne contiene un altro: dentro `ift.zip` c'e'
   * `ift_<hash>.zip`, e solo dentro quello lo shapefile. Si scompatta a
   * cipolla invece di pretendere che l'utente lo faccia a mano.
   */
  async importToscana(zipPath: string): Promise<{ files: number; polygons: number }> {
    const workDir = await mkdtemp(join(tmpdir(), 'ift-'));

    try {
      await unzip(zipPath, workDir);

      // Un livello di annidamento, se c'e'.
      for (const entry of await readdir(workDir)) {
        if (/\.zip$/i.test(entry)) await unzip(join(workDir, entry), workDir);
      }

      const files = await readdir(workDir);
      const shp = files.find((f) => f.toLowerCase().endsWith('.shp'));
      const dbf = files.find((f) => f.toLowerCase().endsWith('.dbf'));
      if (!shp || !dbf) throw new Error(`${zipPath}: .shp o .dbf mancante`);

      const byIstat = await this.provinceAcronyms();
      const count = await this.loadShapefile(join(workDir, shp), join(workDir, dbf), (f, i) =>
        iftRow(f, i, byIstat),
      );

      this.logger.log(`Toscana: ${count} pixel forestali (IFT, rilievo 1985-1993)`);
      return { files: 1, polygons: count };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  /**
   * Sigla di provincia per codice ISTAT.
   *
   * L'IFT identifica la provincia col codice ISTAT ("053"), non con la sigla.
   * La corrispondenza sta gia' nei confini provinciali a database, quindi non
   * serve una tabella scritta a mano che invecchierebbe da sola.
   */
  private async provinceAcronyms(): Promise<Map<string, string>> {
    const rows = await this.prisma.provinceBoundary.findMany({
      select: { istatCode: true, acronym: true },
    });
    return new Map(rows.map((r) => [r.istatCode.padStart(3, '0'), r.acronym]));
  }

  private async loadShapefile(
    shp: string,
    dbf: string,
    toRow: (feature: ShapeFeature, index: number) => Row | null,
  ): Promise<number> {
    const source = await openShapefile(shp, dbf, { encoding: 'utf-8' });

    let batch: Row[] = [];
    let written = 0;
    let index = 0;

    for (;;) {
      const result = await source.read();
      if (result.done) break;

      const feature = result.value as ShapeFeature;
      const row = toRow(feature, index);
      index += 1;
      if (row) batch.push(row);

      if (batch.length >= ForestMapService.BATCH) {
        written += await this.writeBatch(batch);
        batch = [];
      }
    }

    if (batch.length > 0) written += await this.writeBatch(batch);
    return written;
  }

  private async writeBatch(rows: Row[]): Promise<number> {
    const values: unknown[] = [];
    const tuples: string[] = [];

    for (const r of rows) {
      const b = values.length;
      values.push(
        r.source,
        r.objectId,
        r.province,
        r.typeCode,
        r.typeName,
        r.categoryName,
        r.speciesCode,
        r.speciesName,
        r.species2Name,
        r.management,
        r.municipality,
        r.areaHa,
        r.geoJson,
      );
      const p = (n: number) => `$${b + n}`;
      tuples.push(
        `(${p(1)}::"ForestMapSource", ${p(2)}::integer, ${p(3)}, ${p(4)}, ${p(5)}, ${p(6)}, ` +
          `${p(7)}, ${p(8)}, ${p(9)}, ${p(10)}, ${p(11)}, ${p(12)}::double precision, ` +
          // ST_Multi normalizza i Polygon semplici; ST_MakeValid ripara le
          // autointersezioni che la fotointerpretazione lascia qua e la.
          `ST_Transform(ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${p(13)}), ` +
          `${ForestMapService.SRID[r.source]}))), 4326))`,
      );
    }

    return this.prisma.$executeRawUnsafe(
      `INSERT INTO "forest_polygon" (
         "source","objectId","province","typeCode","typeName","categoryName","speciesCode",
         "speciesName","species2Name","management","municipality","areaHa","geom"
       )
       VALUES ${tuples.join(', ')}
       ON CONFLICT ("source","province","objectId") DO UPDATE SET
         "typeCode"     = EXCLUDED."typeCode",
         "typeName"     = EXCLUDED."typeName",
         "categoryName" = EXCLUDED."categoryName",
         "speciesCode"  = EXCLUDED."speciesCode",
         "speciesName"  = EXCLUDED."speciesName",
         "species2Name" = EXCLUDED."species2Name",
         "management"   = EXCLUDED."management",
         "municipality" = EXCLUDED."municipality",
         "areaHa"       = EXCLUDED."areaHa",
         "geom"         = EXCLUDED."geom",
         "importedAt"   = now()`,
      ...values,
    );
  }
}

interface Row {
  source: ForestMapSource;
  objectId: number;
  province: string;
  typeCode: string;
  typeName: string;
  categoryName: string | null;
  speciesCode: string | null;
  speciesName: string | null;
  species2Name: string | null;
  management: string | null;
  municipality: string | null;
  areaHa: number;
  geoJson: string;
}

interface ShapeFeature {
  geometry: unknown;
  properties: Record<string, unknown>;
}

/** Una riga della Carta forestale emiliana. */
function erRow(feature: ShapeFeature, province: string, index: number): Row | null {
  const p = feature.properties;
  if (!feature.geometry) return null;

  const typeName = text(p['NOMETIPO']);
  if (!typeName) return null;

  const objectId = Number(p['OBJECTID']);

  return {
    source: 'ER_2025',
    objectId: Number.isFinite(objectId) ? objectId : index,
    province,
    typeCode: text(p['COD_TIPO']) ?? '',
    typeName,
    categoryName: text(p['NOMECAT']),
    speciesCode: text(p['PRIMA_SP']),
    speciesName: text(p['SPECIE1']),
    species2Name: text(p['SPECIE2']),
    management: text(p['NOMECOLTU']),
    municipality: text(p['NOMECOMU']),
    areaHa: Number(p['AREA_HA']) || 0,
    geoJson: JSON.stringify(feature.geometry),
  };
}

/**
 * Un pixel dell'Inventario Forestale Toscano.
 *
 * Tre differenze di vocabolario rispetto all'Emilia-Romagna, tutte da tenere
 * a mente leggendo il codice:
 *
 *  - la categoria forestale sta in `CATFOR`, non in `NOMETIPO`. Il campo
 *    `TIPO` dell'IFT non e' la tipologia ma la **purezza** del bosco - "Bosco
 *    puro", "a prevalenza", "misto" - e finisce fra le categorie;
 *  - `SPECFOR_1` da' il nome volgare ("Cerro") e non il binomio latino;
 *  - `COLTSTRU` sarebbe il governo del bosco ma e' un codice numerico senza
 *    legenda pubblicata, e descriverebbe i primi anni Novanta: resta fuori.
 *
 * Si scartano i pixel non boscati - vuoti, terreni saldi, non classificabili -
 * perche' l'unica cosa che ci fanno a database e' rallentare le query.
 */
function iftRow(
  feature: ShapeFeature,
  index: number,
  provinceByIstat: Map<string, string>,
): Row | null {
  const p = feature.properties;
  if (!feature.geometry) return null;

  const category = text(p['CATFOR']);
  if (!category || NON_FOREST.has(category.toLowerCase())) return null;

  const istat = (text(p['CODPROV']) ?? '').padStart(3, '0');

  return {
    source: 'IFT_TOSCANA',
    // Il numero d'ordine e non GID: quello ha due collisioni su 143.728.
    objectId: index,
    province: provinceByIstat.get(istat) ?? istat,
    typeCode: istat,
    typeName: category,
    // "Bosco puro" / "a prevalenza" / "misto": non e' la tipologia, ma dice
    // quanto la specie prevalente domina davvero, che vale come categoria.
    categoryName: text(p['TIPO']),
    speciesCode: null,
    speciesName: text(p['SPECFOR_1']),
    species2Name: text(p['SPECFOR_2']),
    management: null,
    municipality: text(p['NOME']),
    // Pixel di 400 m di lato: 16 ettari, che il campo AREA conferma in m2.
    areaHa: (Number(p['AREA']) || 160_000) / 10_000,
    geoJson: JSON.stringify(feature.geometry),
  };
}

/** Categorie IFT che non sono bosco e non meritano una riga. */
const NON_FOREST = new Set(['terreni saldi', 'non classificabile']);

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Estrae uno zip con `unzip`, disponibile su macOS e su ogni immagine Linux sensata. */
function unzip(zipPath: string, target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('unzip', ['-oq', zipPath, '-d', target], { stdio: 'ignore' });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`unzip uscito con codice ${code}`)),
    );
  });
}
