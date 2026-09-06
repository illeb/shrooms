import { readFile, writeFile } from 'node:fs/promises';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { BOLETUS_EDULIS, type SpeciesProfile } from '@mushrooms/mycology-core';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { PrismaService } from '../prisma/prisma.service';
import { speciesProfileSchema } from './species-profile.schema';

/** Profili integrati nel codice, usati come punto di partenza. */
const BUILTIN_PROFILES: Record<string, SpeciesProfile> = {
  [BOLETUS_EDULIS.species]: BOLETUS_EDULIS,
};

/**
 * Gestione dei profili di specie.
 *
 * Il ciclo che rende il modello davvero modificabile senza toccare codice:
 *
 *   model:export  ->  YAML su disco
 *   (si editano i numeri)
 *   model:load    ->  validazione + nuova versione a database
 *   predict:run   ->  punteggi ricalcolati con la versione attiva
 *
 * Le versioni non si sovrascrivono: si affiancano. Ogni punteggio ricorda con
 * quale profilo e' stato prodotto, quindi due tarature sono confrontabili a
 * parita' di dati invece di cancellarsi a vicenda.
 */
@Injectable()
export class SpeciesModelService {
  private readonly logger = new Logger(SpeciesModelService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  builtin(species: string): SpeciesProfile {
    const profile = BUILTIN_PROFILES[species];
    if (!profile) {
      const known = Object.keys(BUILTIN_PROFILES).join(', ');
      throw new Error(`Nessun profilo integrato per "${species}". Disponibili: ${known}`);
    }
    return profile;
  }

  /** Scrive un profilo su disco in YAML, pronto da editare. */
  async exportToYaml(species: string, filePath: string): Promise<void> {
    const active = await this.prisma.speciesModel.findFirst({
      where: { species, active: true },
    });

    const profile = active ? (active.profile as unknown as SpeciesProfile) : this.builtin(species);

    const header = [
      `# Profilo di specie: ${profile.label}`,
      '#',
      '# Modificare i numeri qui dentro e ricaricare con:',
      `#   pnpm --filter @mushrooms/api cli model:load --file=${filePath}`,
      '#',
      '# Ogni caricamento crea una NUOVA versione: le precedenti restano,',
      '# e i punteggi gia calcolati continuano a riferirsi alla loro.',
      '#',
      '# La provenienza di ogni valore e documentata nel profilo integrato:',
      '#   packages/mycology-core/src/profiles/boletus-edulis.ts',
      '',
    ].join('\n');

    await writeFile(filePath, `${header}${stringifyYaml(profile)}`, 'utf8');
    this.logger.log(`Profilo ${species} v${profile.version} esportato in ${filePath}`);
  }

  /**
   * Carica un profilo da YAML, lo valida e lo registra come nuova versione attiva.
   *
   * La validazione non e' una formalita': un refuso in una chiave di feature
   * produrrebbe una regola sempre saltata, cioe' un modello che gira e da
   * risultati plausibili ma ignora silenziosamente meta' dei criteri.
   */
  async loadFromYaml(filePath: string): Promise<SpeciesProfile> {
    const raw = await readFile(filePath, 'utf8');
    const parsed = speciesProfileSchema.safeParse(parseYaml(raw));

    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('\n');
      throw new Error(`Profilo non valido (${filePath}):\n${issues}`);
    }

    return this.activate(parsed.data as SpeciesProfile, filePath);
  }

  /** Registra il profilo integrato come versione attiva. */
  async loadBuiltin(species: string): Promise<SpeciesProfile> {
    return this.activate(this.builtin(species), 'builtin');
  }

  private async activate(profile: SpeciesProfile, source: string): Promise<SpeciesProfile> {
    const latest = await this.prisma.speciesModel.findFirst({
      where: { species: profile.species },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    // La versione dichiarata nel profilo e' un'intenzione dell'autore; se
    // collide con una gia' presente si avanza, invece di sovrascrivere dati
    // a cui dei punteggi fanno gia' riferimento.
    const version =
      latest && profile.version <= latest.version ? latest.version + 1 : profile.version;

    if (version !== profile.version) {
      this.logger.warn(
        `Versione ${profile.version} gia' presente per ${profile.species}: registrata come v${version}.`,
      );
    }

    const stored = { ...profile, version };

    await this.prisma.$transaction([
      this.prisma.speciesModel.updateMany({
        where: { species: profile.species, active: true },
        data: { active: false },
      }),
      this.prisma.speciesModel.create({
        data: {
          species: stored.species,
          version,
          label: stored.label,
          profile: stored as unknown as object,
          active: true,
          source,
        },
      }),
    ]);

    this.logger.log(`${stored.species} v${version} attivo (da ${source})`);
    return stored;
  }

  /** Profilo attivo di una specie, con il suo id a database. */
  async active(species: string): Promise<{ id: string; profile: SpeciesProfile }> {
    const row = await this.prisma.speciesModel.findFirst({
      where: { species, active: true },
      orderBy: { version: 'desc' },
    });

    if (row) return { id: row.id, profile: row.profile as unknown as SpeciesProfile };

    // Primo avvio: registriamo il profilo integrato invece di fallire.
    this.logger.log(`Nessun profilo attivo per ${species}: registro quello integrato.`);
    await this.loadBuiltin(species);
    return this.active(species);
  }

  async list(): Promise<
    Array<{ species: string; version: number; active: boolean; source: string | null }>
  > {
    return this.prisma.speciesModel.findMany({
      select: { species: true, version: true, active: true, source: true },
      orderBy: [{ species: 'asc' }, { version: 'desc' }],
    });
  }
}
