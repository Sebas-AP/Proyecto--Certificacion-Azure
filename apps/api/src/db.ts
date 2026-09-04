import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;
export const pool = new Pool({ connectionString: config.DATABASE_URL });

export function classifyReadiness(databaseAvailable: boolean): {
  statusCode: 200 | 503;
  body: { status: 'ready' } | { status: 'not_ready'; error: 'database_unavailable' };
} {
  return databaseAvailable
    ? { statusCode: 200, body: { status: 'ready' } }
    : { statusCode: 503, body: { status: 'not_ready', error: 'database_unavailable' } };
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
