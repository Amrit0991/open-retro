import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import type { BoardSnapshot } from '../../src/shared/protocol';
import type { BoardRoom } from '../../src/worker/boardroom/boardroom';

// Env.BOARDROOM is a non-parameterized DurableObjectNamespace, so .get() returns
// DurableObjectStub<undefined>. Cast to the concrete class so runInDurableObject's
// `instance` is typed as BoardRoom.
function freshStub(): DurableObjectStub<BoardRoom> {
  const id = env.BOARDROOM.newUniqueId();
  return env.BOARDROOM.get(id) as unknown as DurableObjectStub<BoardRoom>;
}

describe('BoardDb seed + snapshot', () => {
  it('seeds template columns idempotently and returns meta', async () => {
    const stub = freshStub();
    const snap = await runInDurableObject<BoardRoom, BoardSnapshot>(stub, (instance) => {
      instance.db.seed('sailboat', 6, 'owner-1');
      instance.db.seed('sailboat', 6, 'owner-1'); // second call must not double-seed
      return instance.db.snapshot('owner-1');
    });
    expect(snap.meta).toEqual({ template: 'sailboat', maxVotes: 6, ownerId: 'owner-1' });
    expect(snap.columns.map((c: any) => c.id)).toEqual(['wind', 'anchors', 'rocks', 'island']);
    expect(snap.cards).toEqual([]);
    expect(snap.yourVotes).toEqual({});
  });
});
