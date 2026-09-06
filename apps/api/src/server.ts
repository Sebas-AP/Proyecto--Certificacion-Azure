import { config } from './config.js';
import { pool } from './db.js';
import { buildApp } from './app.js';

const app = await buildApp();

const close = async () => {
  await app.close();
  await pool.end();
};
process.once('SIGINT', close);
process.once('SIGTERM', close);

await app.listen({ port: config.PORT, host: '0.0.0.0' });