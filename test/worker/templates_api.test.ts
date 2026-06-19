import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { issueToken } from '../../src/worker/auth/tokens';

async function login(email: string): Promise<string> {
  const raw = await issueToken(env, email);
  const res = await SELF.fetch(`http://localhost:8787/api/auth/verify?token=${encodeURIComponent(raw)}`, { redirect: 'manual' });
  return res.headers.get('set-cookie')!.split(';')[0]; // "session=..."
}

const H = (cookie: string) => ({ cookie, origin: 'http://localhost:8787', 'content-type': 'application/json' });

beforeEach(async () => {
  for (const t of ['templates', 'sessions', 'users', 'magic_tokens']) await env.DB.exec(`DELETE FROM ${t}`);
});

describe('/api/templates', () => {
  it('GET returns built-ins + the caller’s custom templates', async () => {
    const cookie = await login('t@x.com');
    const created = await (await SELF.fetch('http://localhost:8787/api/templates', {
      method: 'POST', headers: H(cookie),
      body: JSON.stringify({ name: 'Mine', columns: [{ title: 'A', subtitle: '', tone: 'green' }] }),
    })).json<any>();
    const list = await (await SELF.fetch('http://localhost:8787/api/templates', { headers: H(cookie) })).json<any>();
    expect(list.builtins.map((t: any) => t.id)).toContain('sailboat');
    expect(list.builtins.every((t: any) => t.readOnly)).toBe(true);
    expect(list.custom.map((t: any) => t.id)).toContain(created.id);
  });

  it('rejects invalid input (no columns / bad tone / too many)', async () => {
    const cookie = await login('t@x.com');
    const bad = await SELF.fetch('http://localhost:8787/api/templates', {
      method: 'POST', headers: H(cookie),
      body: JSON.stringify({ name: '', columns: [] }),
    });
    expect(bad.status).toBe(400);
  });

  it('PUT/DELETE are owner-scoped (404 for non-owner)', async () => {
    const owner = await login('o@x.com');
    const t = await (await SELF.fetch('http://localhost:8787/api/templates', {
      method: 'POST', headers: H(owner),
      body: JSON.stringify({ name: 'Mine', columns: [{ title: 'A', subtitle: '', tone: 'green' }] }),
    })).json<any>();
    const other = await login('g@x.com');
    const put = await SELF.fetch(`http://localhost:8787/api/templates/${t.id}`, {
      method: 'PUT', headers: H(other),
      body: JSON.stringify({ name: 'X', columns: [{ title: 'A', subtitle: '', tone: 'green' }] }),
    });
    expect(put.status).toBe(404);
    const del = await SELF.fetch(`http://localhost:8787/api/templates/${t.id}`, { method: 'DELETE', headers: H(other) });
    expect(del.status).toBe(404);
  });
});
