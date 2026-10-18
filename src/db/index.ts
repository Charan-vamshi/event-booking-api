import { Pool } from 'pg';
import { config } from '../config';

// Optimization (Connection Pooling):
// Uses Supabase transaction pooler (port 6543) via DATABASE_URL_POOLED if provided,
// falling back to DATABASE_URL. Prevents exhausting direct Postgres connection limits
// under high concurrent request loads. Pool capped at 20 with 5s connection timeout.
const connectionString = config.databaseUrlPooled || config.databaseUrl;

const isLocalhost =
  connectionString.includes('localhost') ||
  connectionString.includes('127.0.0.1');

export const pool = new Pool({
  connectionString,
  ssl: isLocalhost || !connectionString ? false : { rejectUnauthorized: false },
  max: 20,
  connectionTimeoutMillis: 5000,
});

export const query = (text: string, params?: unknown[]) => {
  return pool.query(text, params);
};
