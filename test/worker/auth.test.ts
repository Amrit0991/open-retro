import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { issueToken, consumeToken } from '../../src/worker/auth/tokens';

beforeEach(async () => {
  await env.DB.exec('DELETE FROM magic_tokens');
  await env.DB.exec('DELETE FROM users');
  await env.DB.exec('DELETE FROM sessions');
});

describe('magic tokens', () => {
  it('issues then consumes exactly once', async () => {
    const raw = await issueToken(env, 'a@b.com');
    expect(await consumeToken(env, raw)).toBe('a@b.com');
    expect(await consumeToken(env, raw)).toBeNull(); // single-use
  });

  it('rejects unknown/expired token', async () => {
    expect(await consumeToken(env, 'nope')).toBeNull();
  });
});

describe('POST /api/auth/request', () => {
  it('returns uniform 200 for any email and stores a token', async () => {
    const res = await SELF.fetch('http://x/api/auth/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:8787' },
      body: JSON.stringify({ email: 'c@d.com' }),
    });
    expect(res.status).toBe(200);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM magic_tokens').first<{ n: number }>();
    expect(n!.n).toBe(1);
  });
});
