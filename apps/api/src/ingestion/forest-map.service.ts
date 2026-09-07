import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { open as openShapefile } from 'shapefile';
import { PrismaService } from '../prisma/prisma.service';
import { spawn } from 'node:child_process';

/**
 * Importa la Carta forestale regionale 2025 dagli shapefile provinciali.
 *
 * E' la carta forestale vera, non l'uso del suolo: dove quella diceva "Boschi
 * a prevalenza di querce, carpini e castagni", questa distingue Cerrete da
 * Boschi di Roverella da Orno-ostrieti, e per ognuna riporta la specie
 * botanica prevalente e il governo del bosco.
 *
 * Gli shapefile sono in RDN2008/UTM zone 32N (EPSG:7791): la riproiezione a
 * WGS84 la fa PostGIS, che sa gia' come si fa.
 */
@Injectable()
export class ForestMapService {
  private readonly logger = new Logger(ForestMapService.name);

  /** Sistema di riferimento degli shapefile regionali. */
  private static readonly SOURCE_SRID = 7791;

  /** Poligoni per INSERT: geometrie grosse, meglio transazioni corte. */
  private static readonly BATCH = 200;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Carica tutti gli archivi `CartaForestale2025XX.zip` di una cartella.
   *
   * Idempotente su (provincia, objectId): rilanciare aggiorna invece di
   * duplicare.
   */
  async importFromDirectory(directory: string): Promise<{ files: number; polygons: number }> {
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
      polygons += await this.importArchive(join(directory, archive));
    }

    this.logger.log(`${archives.length} province, ${polygons} poligoni forestali.`);
    return { files: archives.length, polygons };
  }

  private async importArchive(zipPath: string): Promise<number> {
    const province = basename(zipPath).replace(/^CartaForestale2025/i, '').replace(/\.zip$/i, '');
    const workDir = await mkdtemp(join(tmpdir(), 'carta-forestale-'));

    try {
      await unzip(zipPath, workDir);

      const files = await readdir(workDir);
      const shp = files.find((f) => f.toLowerCase().endsWith('.shp'));
      const dbf = files.find((f) => f.toLowerCase().endsWith('.dbf'));
      if (!shp || !dbf) throw new Error(`${zipPath}: .shp o .dbf mancante`);

      const count = await this.loadShapefile(join(workDir, shp), join(workDir, dbf), province);
      this.logger.log(`${province}: ${count} poligoni`);
      return count;
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  private async loadShapefile(shp: string, dbf: string, province: string): Promise<number> {
    const source = await openShapefile(shp, dbf, { encoding: 'utf-8' });

    let batch: Row[] = [];
    let written = 0;

    for (;;) {
      const result = await source.read();
      if (result.done) break;

      const feature = result.value as ShapeFeature;
      const row = toRow(feature, province);
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
        `(${p(1)}::integer, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, ${p(6)}, ${p(7)}, ${p(8)}, ` +
          `${p(9)}, ${p(10)}, ${p(11)}::double precision, ` +
          // ST_Multi normalizza i Polygon semplici; ST_MakeValid ripara le
          // autointersezioni che la fotointerpretazione lascia qua e la.
          `ST_Transform(ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${p(12)}), ${ForestMapService.SOURCE_SRID}))), 4326))`,
      );
    }

    return this.prisma.$executeRawUnsafe(
      `INSERT INTO "forest_polygon" (
         "objectId","province","typeCode","typeName","categoryName","speciesCode",
         "speciesName","species2Name","management","municipality","areaHa","geom"
       )
       VALUES ${tuples.join(', ')}
       ON CONFLICT ("province","objectId") DO UPDATE SET
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

function toRow(feature: ShapeFeature, province: string): Row | null {
  const p = feature.properties;
  if (!feature.geometry) return null;

  const objectId = Number(p['OBJECTID']);
  const typeName = text(p['NOMETIPO']);
  if (!Number.isFinite(objectId) || !typeName) return null;

  return {
    objectId,
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
