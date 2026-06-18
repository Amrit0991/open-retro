import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('schema', () => {
  it('boards table exists', async () => {
    const r = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='boards'",
    ).first();
    expect(r?.name).toBe('boards');
  });
});
