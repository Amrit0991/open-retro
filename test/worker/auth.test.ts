import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { issueToken, consumeToken } from '../../src/worker/auth/tokens';
import { randomToken, sha256Hex } from '../../src/worker/auth/crypto';
import { upsertUserByEmail, createSession } from '../../src/worker/auth/sessions';
import { tooManyRecently } from '../../src/worker/auth/rateLimit';

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

  it('rejects an expired (but otherwise valid) token', async () => {
    const raw = randomToken();
    const past = Date.now() - 1000;
    await env.DB.prepare(
      'INSERT INTO magic_tokens (token_hash, email, expires_at, consumed_at, created_at) VALUES (?,?,?,NULL,?)',
    )
      .bind(await sha256Hex(raw), 'old@expired.com', past, past - 1000)
      .run();
    expect(await consumeToken(env, raw)).toBeNull();
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

describe('verify + session', () => {
  it('verify consumes token, sets cookie, redirects to /', async () => {
    const raw = await issueToken(env, 'e@f.com');
    const res = await SELF.fetch(
      `http://localhost:8787/api/auth/verify?token=${encodeURIComponent(raw)}`,
      { redirect: 'manual' },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
    expect(res.headers.get('set-cookie')).toMatch(/session=/);
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly/i);
  });

  it('rejects a request to a protected route without a session', async () => {
    const res = await SELF.fetch('http://localhost:8787/api/boards', {
      headers: { origin: 'http://localhost:8787' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects mutating request from a foreign origin', async () => {
    const res = await SELF.fetch('http://localhost:8787/api/auth/logout', {
      method: 'POST',
      headers: { origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
  });
});

describe('email rate limiting', () => {
  it('flags more than 5 requests per email per hour', async () => {
    await env.DB.exec('DELETE FROM magic_tokens');
    for (let i = 0; i < 5; i++) await issueToken(env, 'spam@x.com');
    expect(await tooManyRecently(env, 'spam@x.com')).toBe(true);
    expect(await tooManyRecently(env, 'other@x.com')).toBe(false);
  });
});

describe('GET /api/me', () => {
  it('returns 401 without a session cookie', async () => {
    const res = await SELF.fetch('http://localhost:8787/api/me', {
      headers: { origin: 'http://localhost:8787' },
    });
    expect(res.status).toBe(401);
  });

  it('returns the current user with a valid session cookie', async () => {
    const userId = await upsertUserByEmail(env, 'me@example.com');
    const raw = await createSession(env, userId);
    const res = await SELF.fetch('http://localhost:8787/api/me', {
      headers: { origin: 'http://localhost:8787', cookie: `session=${raw}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ id: string; email: string; display_name: string }>();
    expect(body.id).toBe(userId);
    expect(body.email).toBe('me@example.com');
    expect(body.display_name).toBe('me');
  });
});
