import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { issueToken } from '../../src/worker/auth/tokens';

async function login(email: string): Promise<string> {
  const raw = await issueToken(env, email);
  const res = await SELF.fetch(`http://localhost:8787/api/auth/verify?token=${encodeURIComponent(raw)}`, { redirect: 'manual' });
  return res.headers.get('set-cookie')!.split(';')[0]; // "session=..."
}

beforeEach(async () => {
  for (const t of ['boards', 'board_members', 'sessions', 'users', 'magic_tokens'])
    await env.DB.exec(`DELETE FROM ${t}`);
});

describe('boards CRUD', () => {
  it('creates a board, lists it, owner is a member', async () => {
    const cookie = await login('o@x.com');
    const create = await SELF.fetch('http://localhost:8787/api/boards', {
      method: 'POST', headers: { cookie, origin: 'http://localhost:8787', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Sprint 12', template: 'sailboat', maxVotes: 6 }),
    });
    expect(create.status).toBe(200);
    const board = await create.json<{ id: string; role: string }>();
    expect(board.role).toBe('owner');

    const list = await SELF.fetch('http://localhost:8787/api/boards', { headers: { cookie, origin: 'http://localhost:8787' } });
    expect((await list.json<any[]>()).map(b => b.id)).toContain(board.id);
  });

  it('rejects invalid template / max_votes', async () => {
    const cookie = await login('o@x.com');
    const res = await SELF.fetch('http://localhost:8787/api/boards', {
      method: 'POST', headers: { cookie, origin: 'http://localhost:8787', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x', template: 'nope', maxVotes: 999 }),
    });
    expect(res.status).toBe(400);
  });
});

describe('join', () => {
  it('lets a second logged-in user join via the link and then see the board', async () => {
    const owner = await login('o2@x.com');
    const created = await (await SELF.fetch('http://localhost:8787/api/boards', {
      method: 'POST', headers: { cookie: owner, origin: 'http://localhost:8787', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'B', template: 'three_little_pigs', maxVotes: 3 }),
    })).json<{ id: string }>();

    const guest = await login('g@x.com');
    const before = await SELF.fetch(`http://localhost:8787/api/boards/${created.id}`, { headers: { cookie: guest, origin: 'http://localhost:8787' } });
    expect(before.status).toBe(404); // not a member yet

    const join = await SELF.fetch(`http://localhost:8787/api/boards/${created.id}/join`, {
      method: 'POST', headers: { cookie: guest, origin: 'http://localhost:8787' } });
    expect(join.status).toBe(200);

    const after = await SELF.fetch(`http://localhost:8787/api/boards/${created.id}`, { headers: { cookie: guest, origin: 'http://localhost:8787' } });
    expect(after.status).toBe(200);
  });
});
