import type { CodegenConfig } from '@graphql-codegen/cli';

/**
 * Genera i tipi TypeScript delle operazioni GraphQL usate dal frontend.
 *
 * Prerequisito: `schema.graphql` aggiornato, cioè una build (o un avvio)
 * dell'API. Sequenza tipica:
 *
 *   pnpm --filter @mushrooms/api build
 *   pnpm --filter @mushrooms/graphql-schema codegen
 */
const config: CodegenConfig = {
  schema: './schema.graphql',
  documents: ['../../apps/web/app/**/*.{vue,ts}'],
  ignoreNoDocuments: true,
  generates: {
    './src/generated/': {
      preset: 'client',
      config: { useTypeImports: true },
    },
  },
};

export default config;
