import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { issueToken } from '../../src/worker/auth/tokens';

async function login(email: string): Promise<string> {
  const raw = await issueToken(env, email);
  const res = await SELF.fetch(
    `http://localhost:8787/api/auth/verify?token=${encodeURIComponent(raw)}`,
    { redirect: 'manual' },
  );
  return res.headers.get('set-cookie')!.split(';')[0];
}

beforeEach(async () => {
  for (const t of ['boards', 'board_members', 'sessions', 'users', 'magic_tokens']) {
    await env.DB.exec(`DELETE FROM ${t}`);
  }
});

describe('WS transport', () => {
  it('a member connects and receives an init snapshot with the right column count', async () => {
    const cookie = await login('o@x.com');
    const board = await (
      await SELF.fetch('http://localhost:8787/api/boards', {
        method: 'POST',
        headers: { cookie, origin: 'http://localhost:8787', 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'B', template: 'three_little_pigs', maxVotes: 3 }),
      })
    ).json<{ id: string }>();

    const wsRes = await SELF.fetch(`http://localhost:8787/api/boards/${board.id}/ws`, {
      headers: { upgrade: 'websocket', cookie, origin: 'http://localhost:8787' },
    });
    expect(wsRes.status).toBe(101);
    const ws = wsRes.webSocket!;
    ws.accept();
    const init = await new Promise<any>((res) =>
      ws.addEventListener('message', (e) => res(JSON.parse(e.data as string)), { once: true }),
    );
    expect(init.type).toBe('init');
    expect(init.snapshot.columns).toHaveLength(3);
  });

  it('rejects a non-member upgrade with 403', async () => {
    const owner = await login('o@x.com');
    const board = await (
      await SELF.fetch('http://localhost:8787/api/boards', {
        method: 'POST',
        headers: {
          cookie: owner,
          origin: 'http://localhost:8787',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: 'B', template: 'sailboat', maxVotes: 3 }),
      })
    ).json<{ id: string }>();
    const guest = await login('g@x.com');
    const res = await SELF.fetch(`http://localhost:8787/api/boards/${board.id}/ws`, {
      headers: { upgrade: 'websocket', cookie: guest, origin: 'http://localhost:8787' },
    });
    expect(res.status).toBe(403);
  });
});
