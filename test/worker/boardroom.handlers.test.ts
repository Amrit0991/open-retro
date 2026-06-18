import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import type { ActionResult, BoardSnapshot } from '../../src/shared/protocol';
import type { BoardRoom } from '../../src/worker/boardroom/boardroom';
import {
  handleAddCard,
  handleEditCard,
  handleDeleteCard,
  handleVote,
  handleUnvote,
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

describe('vote handlers (atomic budget)', () => {
  const ACTOR = { userId: 'u1', displayName: 'Ann' };

  it('enforces the board-wide vote budget across cards', async () => {
    const stub = freshStub();
    const out = await runInDurableObject<
      BoardRoom,
      { r1: ActionResult; r2: ActionResult; r3: ActionResult; total: number; mine: number }
    >(stub, (i) => {
      i.db.seed('three_little_pigs', 2, 'owner'); // budget = 2
      handleAddCard(i.db, ACTOR, { clientCardId: 'c1', columnId: 'straws', text: 'a' });
      handleAddCard(i.db, ACTOR, { clientCardId: 'c2', columnId: 'straws', text: 'b' });
      const [a, b] = i.db.snapshot('u1').cards;
      const r1 = handleVote(i.db, ACTOR, { cardId: a.id }); // spend 1
      const r2 = handleVote(i.db, ACTOR, { cardId: a.id }); // spend 2 (2 on same card ok)
      const r3 = handleVote(i.db, ACTOR, { cardId: b.id }); // over budget -> reject
      return { r1, r2, r3, total: i.db.voteTotal(a.id), mine: i.db.userVoteCount(a.id, 'u1') };
    });
    expect(out.r1.broadcast?.[0]).toMatchObject({ type: 'votes_changed', total: 1 });
    expect(out.r1.actor?.[0]).toMatchObject({ type: 'your_vote', yourCount: 1 });
    expect(out.r3.actor?.[0]).toMatchObject({ type: 'error', code: 'budget_exceeded' });
    expect(out.total).toBe(2);
    expect(out.mine).toBe(2);
  });

  it('unvote frees budget and works regardless of cap', async () => {
    const stub = freshStub();
    const out = await runInDurableObject<BoardRoom, { before: number; after: number }>(stub, (i) => {
      i.db.seed('three_little_pigs', 1, 'owner');
      handleAddCard(i.db, ACTOR, { clientCardId: 'c1', columnId: 'straws', text: 'a' });
      const a = i.db.snapshot('u1').cards[0];
      handleVote(i.db, ACTOR, { cardId: a.id });
      const before = i.db.userVoteCount(a.id, 'u1');
      handleUnvote(i.db, ACTOR, { cardId: a.id });
      return { before, after: i.db.userVoteCount(a.id, 'u1') };
    });
    expect(out.before).toBe(1);
    expect(out.after).toBe(0);
  });
});
