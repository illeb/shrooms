import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Il .env vive alla radice del monorepo; un .env locale all'app, se presente,
// ha la precedenza (dotenv non sovrascrive le variabili gia' definite).
loadEnv({ path: '.env', quiet: true });
loadEnv({ path: '../../.env', quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env['DATABASE_URL'] },
});
