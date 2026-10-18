import { Pool } from 'pg';
import { config } from '../config';

const isLocalhost =
  config.databaseUrl.includes('localhost') ||
  config.databaseUrl.includes('127.0.0.1');

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: isLocalhost || !config.databaseUrl ? false : { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

export const query = (text: string, params?: unknown[]) => {
  return pool.query(text, params);
};
