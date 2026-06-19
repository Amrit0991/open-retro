import type { Env } from '../types';

// True when 5+ magic tokens were issued to this email in the trailing hour.
export async function tooManyRecently(env: Env, email: string): Promise<boolean> {
  const since = Date.now() - 60 * 60 * 1000;
  const r = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM magic_tokens WHERE email=? AND created_at > ?',
  )
    .bind(email.toLowerCase(), since)
    .first<{ n: number }>();
  return (r?.n ?? 0) >= 5;
}
