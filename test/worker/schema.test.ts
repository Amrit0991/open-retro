import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('schema', () => {
  it('boards table exists', async () => {
    const r = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='boards'",
    ).first();
    expect(r?.name).toBe('boards');
  });

  it('templates table exists', async () => {
    const r = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='templates'",
    ).first();
    expect(r?.name).toBe('templates');
  });

  it('boards has template_snapshot column', async () => {
    const cols = await env.DB.prepare('PRAGMA table_info(boards)').all<{ name: string }>();
    expect(cols.results.map((c) => c.name)).toContain('template_snapshot');
  });
});
