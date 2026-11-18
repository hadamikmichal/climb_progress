import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Migracje uruchamiamy wyłącznie lokalnie / w CI – connection string nigdy nie trafia do Angulara.
// .env.local (ignorowany przez git) – patrz docs/NEON_SETUP.md
config({ path: '.env.local', quiet: true });

export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema.ts',
  out: './drizzle',
  // Role authenticated / anonymous tworzy Neon (Data API) – Drizzle ich nie zakłada ani nie usuwa
  entities: { roles: { provider: 'neon' } },
  dbCredentials: { url: process.env['DATABASE_URL_UNPOOLED'] ?? process.env['DATABASE_URL'] ?? '' },
  strict: true,
  verbose: true,
});
