import { describe, it, expect } from 'vitest';
import { randomToken, sha256Hex } from '../../src/worker/auth/crypto';

describe('crypto', () => {
  it('randomToken is long and unique', () => {
    const a = randomToken(), b = randomToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(22); // 16 bytes base64url
  });
  it('sha256Hex is deterministic 64-hex', async () => {
    expect(await sha256Hex('x')).toBe(await sha256Hex('x'));
    expect(await sha256Hex('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});
