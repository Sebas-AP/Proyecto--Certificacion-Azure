import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { pool } from './db.js';

const SESSION_DAYS = 1;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + interval '1 day')`,
    [userId, hashToken(token)],
  );
  return token;
}

export async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = request.cookies.session;
  if (!token) {
    await reply.code(401).send({ error: 'Autenticacion requerida' });
    return;
  }

  const result = await pool.query(
    `SELECT u.id, u.company_id, u.display_name, u.email
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.is_active = true`,
    [hashToken(token)],
  );
  const user = result.rows[0];
  if (!user) {
    await reply.code(401).send({ error: 'Sesion invalida o expirada' });
    return;
  }
  request.user = user;
}

export async function userHasPermission(userId: string, permission: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM user_roles ur
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE ur.user_id = $1 AND p.code = $2`,
    [userId, permission],
  );
  return result.rowCount === 1;
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.APP_ENV === 'production',
  path: '/',
  maxAge: SESSION_DAYS * 24 * 60 * 60,
};
