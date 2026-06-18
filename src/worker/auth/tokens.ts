import type { Env } from '../types';
import { randomToken, sha256Hex } from './crypto';

const TTL_MS = 10 * 60 * 1000;

export async function issueToken(env: Env, email: string): Promise<string> {
  const raw = randomToken();
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO magic_tokens (token_hash, email, expires_at, consumed_at, created_at) VALUES (?,?,?,NULL,?)',
  )
    .bind(await sha256Hex(raw), email.toLowerCase(), now + TTL_MS, now)
    .run();
  return raw;
}

// Atomic single-use consume: marks consumed only if unconsumed AND unexpired.
export async function consumeToken(env: Env, raw: string): Promise<string | null> {
  const hash = await sha256Hex(raw);
  const now = Date.now();
  const res = await env.DB.prepare(
    'UPDATE magic_tokens SET consumed_at=?1 WHERE token_hash=?2 AND consumed_at IS NULL AND expires_at > ?1',
  )
    .bind(now, hash)
    .run();
  if ((res.meta.changes ?? 0) !== 1) return null;
  const row = await env.DB.prepare('SELECT email FROM magic_tokens WHERE token_hash=?')
    .bind(hash)
    .first<{ email: string }>();
  return row?.email ?? null;
}
