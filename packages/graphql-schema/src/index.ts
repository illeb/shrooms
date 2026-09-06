import { join } from 'node:path';

/**
 * Percorso assoluto dello schema SDL.
 *
 * Il file è **generato**: l'API NestJS lo riscrive a ogni build in modalità
 * code-first (`autoSchemaFile`). Non va modificato a mano — la fonte di verità
 * sono i resolver e gli `@ObjectType` del backend.
 */
export const SCHEMA_PATH = join(__dirname, '..', 'schema.graphql');

export const GRAPHQL_DEFAULT_ENDPOINT = 'http://localhost:4000/graphql';
