import { it, expect } from 'vitest';
import { reducer, initialState } from '../../src/client/board/reducer';
import type { ServerMessage, BoardSnapshot } from '../../src/shared/protocol';

const snap: BoardSnapshot = {
  meta: { template: 'three_little_pigs', maxVotes: 3, ownerId: 'o' },
  columns: [{ id: 'straws', title: 'S', subtitle: '' }], cards: [], yourVotes: {},
};
const srv = (msg: ServerMessage) => ({ kind: 'server', msg } as const);

it('ignores patches before init', () => {
  const s = reducer(initialState, srv({ type: 'votes_changed', cardId: 'x', total: 5 }));
  expect(s.ready).toBe(false);
});

it('init makes ready and loads columns', () => {
  const s = reducer(initialState, srv({ type: 'init', snapshot: snap }));
  expect(s.ready).toBe(true);
  expect(s.order.straws).toEqual([]);
});

it('optimistic add then card_added with same id dedupes (no double render)', () => {
  let s = reducer(initialState, srv({ type: 'init', snapshot: snap }));
  const card = { id: 'cc1', columnId: 'straws', text: 'hi', authorId: 'me', authorName: 'Me', position: 1024, createdAt: 1, votes: 0 };
  s = reducer(s, { kind: 'optimistic_add', card });
  s = reducer(s, srv({ type: 'card_added', card, clientCardId: 'cc1' }));
  expect(s.order.straws).toEqual(['cc1']); // exactly once
});

it('votes_changed sets the total (never increments)', () => {
  let s = reducer(initialState, srv({ type: 'init', snapshot: { ...snap, cards: [{ id: 'c', columnId: 'straws', text: 't', authorId: 'a', authorName: 'A', position: 1024, createdAt: 1, votes: 0 }] } }));
  s = reducer(s, srv({ type: 'votes_changed', cardId: 'c', total: 2 }));
  s = reducer(s, srv({ type: 'votes_changed', cardId: 'c', total: 2 })); // duplicate delivery
  expect(s.cards['c'].votes).toBe(2);
});

it('reconnect init replaces state wholesale', () => {
  let s = reducer(initialState, srv({ type: 'init', snapshot: { ...snap, cards: [{ id: 'old', columnId: 'straws', text: 'x', authorId: 'a', authorName: 'A', position: 1, createdAt: 1, votes: 0 }] } }));
  s = reducer(s, srv({ type: 'init', snapshot: snap })); // fresh init, no cards
  expect(Object.keys(s.cards)).toEqual([]);
});
