import { describe, expect, it } from 'vitest';

process.env.DATABASE_URL ??= 'postgres://gorditas:gorditas@localhost:5432/gorditasos';
process.env.SESSION_SECRET ??= 'test-session-secret-that-is-long-enough';

const { classifyReadiness } = await import('../apps/api/src/db.js');

describe('clasificacion de readiness', () => {
  it('marca la API como lista cuando la base de datos responde', () => {
    expect(classifyReadiness(true)).toEqual({ statusCode: 200, body: { status: 'ready' } });
  });

  it('devuelve un error generico sin exponer configuracion cuando falla la base de datos', () => {
    expect(classifyReadiness(false)).toEqual({
      statusCode: 503,
      body: { status: 'not_ready', error: 'database_unavailable' },
    });
  });
});