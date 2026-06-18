import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import type { ActionResult, BoardSnapshot } from '../../src/shared/protocol';
import type { BoardRoom } from '../../src/worker/boardroom/boardroom';
import {
  handleAddCard,
  handleEditCard,
  handleDeleteCard,
} from '../../src/worker/boardroom/handlers';

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

describe('card handlers (add/edit/delete)', () => {
  const ACTOR = { userId: 'u1', displayName: 'Ann' };

  it('add_card inserts and echoes clientCardId', async () => {
    const stub = freshStub();
    const res = await runInDurableObject<BoardRoom, ActionResult>(stub, (i) => {
      i.db.seed('three_little_pigs', 3, 'u1');
      return handleAddCard(i.db, ACTOR, { clientCardId: 'cc1', columnId: 'straws', text: 'flaky tests' });
    });
    expect(res.broadcast?.[0]).toMatchObject({ type: 'card_added', clientCardId: 'cc1' });
    expect((res.broadcast?.[0] as any).card).toMatchObject({
      columnId: 'straws',
      text: 'flaky tests',
      authorId: 'u1',
      authorName: 'Ann',
      votes: 0,
    });
  });

  it('edit_card by non-author is rejected', async () => {
    const stub = freshStub();
    const res = await runInDurableObject<BoardRoom, ActionResult>(stub, (i) => {
      i.db.seed('three_little_pigs', 3, 'owner');
      handleAddCard(i.db, ACTOR, { clientCardId: 'cc1', columnId: 'straws', text: 'x' });
      const card = i.db.snapshot('u1').cards[0];
      return handleEditCard(i.db, { userId: 'intruder', displayName: 'I' }, { cardId: card.id, text: 'hacked' });
    });
    expect(res.actor?.[0]).toMatchObject({ type: 'error', code: 'forbidden' });
  });

  it('owner can delete another user card and votes are gone', async () => {
    const stub = freshStub();
    const res = await runInDurableObject<BoardRoom, { del: ActionResult; remaining: number }>(stub, (i) => {
      i.db.seed('three_little_pigs', 3, 'owner');
      handleAddCard(i.db, ACTOR, { clientCardId: 'cc1', columnId: 'straws', text: 'x' });
      const card = i.db.snapshot('u1').cards[0];
      const del = handleDeleteCard(i.db, { userId: 'owner', displayName: 'O' }, { cardId: card.id });
      return { del, remaining: i.db.snapshot('u1').cards.length };
    });
    expect(res.del.broadcast?.[0]).toMatchObject({ type: 'card_deleted' });
    expect(res.remaining).toBe(0);
  });
});
