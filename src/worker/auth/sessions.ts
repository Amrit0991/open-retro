import type { Context } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import type { Env } from '../types';
import { randomToken, sha256Hex } from './crypto';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function upsertUserByEmail(env: Env, email: string): Promise<string> {
  const e = email.toLowerCase();
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email=?')
    .bind(e)
    .first<{ id: string }>();
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO users (id,email,display_name,created_at) VALUES (?,?,?,?)')
    .bind(id, e, e.split('@')[0], Date.now())
    .run();
  return id;
}

export async function createSession(env: Env, userId: string): Promise<string> {
  const raw = randomToken();
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO sessions (id_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)',
  )
    .bind(await sha256Hex(raw), userId, now + SESSION_TTL_MS, now)
    .run();
  return raw;
}

export async function userIdForSession(env: Env, raw: string | undefined): Promise<string | null> {
  if (!raw) return null;
  const row = await env.DB.prepare('SELECT user_id, expires_at FROM sessions WHERE id_hash=?')
    .bind(await sha256Hex(raw))
    .first<{ user_id: string; expires_at: number }>();
  if (!row || row.expires_at < Date.now()) return null;
  return row.user_id;
}

export async function deleteSession(env: Env, raw: string | undefined): Promise<void> {
  if (!raw) return;
  await env.DB.prepare('DELETE FROM sessions WHERE id_hash=?').bind(await sha256Hex(raw)).run();
}

export function setSessionCookie(c: Context<{ Bindings: Env }>, raw: string) {
  setCookie(c, 'session', raw, {
    httpOnly: true,
    // Secure in production (APP_ORIGIN is https) but dropped for local http E2E,
    // where Chromium would otherwise refuse to send the cookie back over ws://.
    secure: c.env.APP_ORIGIN.startsWith('https'),
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(c: Context<{ Bindings: Env }>) {
  deleteCookie(c, 'session', { path: '/' });
}
