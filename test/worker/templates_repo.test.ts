import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import * as repo from '../../src/worker/templates/repo';

beforeEach(async () => { await env.DB.exec('DELETE FROM templates'); });

const cols = [
  { title: 'Loved', subtitle: 'what went great', tone: 'green' as const },
  { title: 'Lacked', subtitle: 'what was missing', tone: 'coral' as const },
];

describe('templates repo', () => {
  it('creates and lists owner templates with parsed columns + default icon', async () => {
    const t = await repo.createTemplate(env, 'u1', 'My Retro', cols);
    expect(t.name).toBe('My Retro');
    expect(t.readOnly).toBe(false);
    expect(t.columns).toHaveLength(2);
    expect(t.columns[0]).toMatchObject({ title: 'Loved', tone: 'green', icon: 'layers' });
    expect(t.columns[0].id).toBeTruthy();
    const list = await repo.listTemplates(env, 'u1');
    expect(list.map((x) => x.id)).toContain(t.id);
    expect(await repo.listTemplates(env, 'other')).toHaveLength(0);
  });

  it('update/delete are owner-scoped', async () => {
    const t = await repo.createTemplate(env, 'u1', 'Mine', cols);
    expect(await repo.updateTemplate(env, t.id, 'intruder', 'Hacked', cols)).toBe(false);
    expect(await repo.updateTemplate(env, t.id, 'u1', 'Renamed', cols)).toBe(true);
    expect((await repo.getTemplate(env, t.id))!.name).toBe('Renamed');
    expect(await repo.deleteTemplate(env, t.id, 'intruder')).toBe(false);
    expect(await repo.deleteTemplate(env, t.id, 'u1')).toBe(true);
    expect(await repo.getTemplate(env, t.id)).toBeNull();
  });
});
