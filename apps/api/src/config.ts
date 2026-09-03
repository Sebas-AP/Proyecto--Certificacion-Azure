import 'dotenv/config';
import { z } from 'zod';

const configSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  CORS_ORIGIN: z.string().url().default('http://localhost:5173'),
});

export const config = configSchema.parse({
  APP_ENV: process.env.APP_ENV,
  PORT: process.env.PORT,
  DATABASE_URL: process.env.DATABASE_URL,
  SESSION_SECRET: process.env.SESSION_SECRET,
  CORS_ORIGIN: process.env.CORS_ORIGIN,
});
