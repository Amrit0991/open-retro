import type { BoardDb } from './boarddb';
import type { ActionResult, Identity } from '../../shared/protocol';
import { LIMITS } from '../../shared/protocol';

// Socket-independent action handlers. Each is a pure function over (db, actor,
// payload) returning an ActionResult: actor[] go to the acting socket only,
// broadcast[] go to every connected socket. Keeping these free of WebSocket
// concerns is what makes them unit-testable.

const err = (code: string, msg = code): ActionResult => ({ actor: [{ type: 'error', code, msg }] });

export function handleAddCard(
  db: BoardDb,
  actor: Identity,
  p: { clientCardId: string; columnId: string; text: string },
): ActionResult {
  const text = (p.text ?? '').trim();
  if (!text || text.length > LIMITS.cardText) return err('bad_text');
  if (!db.columnExists(p.columnId)) return err('bad_column');
  const id = /^[0-9a-f-]{8,}$/i.test(p.clientCardId) ? p.clientCardId : crypto.randomUUID();
  const card = db.addCard({
    id,
    columnId: p.columnId,
    text,
    authorId: actor.userId,
    authorName: actor.displayName,
  });
  return { broadcast: [{ type: 'card_added', card, clientCardId: p.clientCardId }] };
}

function authorOrOwner(db: BoardDb, actor: Identity, authorId: string): boolean {
  return actor.userId === authorId || actor.userId === db.getMeta().ownerId;
}

export function handleEditCard(
  db: BoardDb,
  actor: Identity,
  p: { cardId: string; text: string },
): ActionResult {
  const card = db.getCard(p.cardId);
  if (!card) return err('not_found');
  if (!authorOrOwner(db, actor, card.authorId)) return err('forbidden');
  const text = (p.text ?? '').trim();
  if (!text || text.length > LIMITS.cardText) return err('bad_text');
  db.editCard(p.cardId, text);
  return { broadcast: [{ type: 'card_edited', cardId: p.cardId, text }] };
}

export function handleDeleteCard(
  db: BoardDb,
  actor: Identity,
  p: { cardId: string },
): ActionResult {
  const card = db.getCard(p.cardId);
  if (!card) return err('not_found');
  if (!authorOrOwner(db, actor, card.authorId)) return err('forbidden');
  db.deleteCard(p.cardId);
  return { broadcast: [{ type: 'card_deleted', cardId: p.cardId }] };
}

// After a vote count changes: broadcast the new card total to everyone, and tell
// the acting socket its own (possibly capped) count for that card.
function voteResult(db: BoardDb, actor: Identity, cardId: string): ActionResult {
  return {
    broadcast: [{ type: 'votes_changed', cardId, total: db.voteTotal(cardId) }],
    actor: [{ type: 'your_vote', cardId, yourCount: db.userVoteCount(cardId, actor.userId) }],
  };
}

export function handleVote(db: BoardDb, actor: Identity, p: { cardId: string }): ActionResult {
  if (!db.getCard(p.cardId)) return err('not_found');
  if (!db.voteAtomic(p.cardId, actor.userId)) return err('budget_exceeded');
  return voteResult(db, actor, p.cardId);
}

export function handleUnvote(db: BoardDb, actor: Identity, p: { cardId: string }): ActionResult {
  if (!db.getCard(p.cardId)) return err('not_found');
  db.unvote(p.cardId, actor.userId);
  return voteResult(db, actor, p.cardId);
}

// Drag a card to a new column/position. Neighbour ids come from the client but
// their positions are re-read server-side (see BoardDb.moveCard). A normal move
// broadcasts `card_moved`; a renormalized column broadcasts `cards_reordered`.
export function handleMoveCard(
  db: BoardDb,
  _actor: Identity,
  p: { cardId: string; toColumnId: string; beforeId: string | null; afterId: string | null },
): ActionResult {
  if (!db.getCard(p.cardId)) return err('not_found');
  if (!db.columnExists(p.toColumnId)) return err('bad_column');
  const r = db.moveCard(p.cardId, p.toColumnId, p.beforeId, p.afterId);
  if (r.type === 'moved') {
    return { broadcast: [{ type: 'card_moved', cardId: p.cardId, columnId: r.columnId, position: r.position }] };
  }
  return { broadcast: [{ type: 'cards_reordered', columnId: r.columnId, positions: r.positions }] };
}

// Owner-only board setting. Identity is taken from `actor`/`getMeta`, never the
// payload. `mirrorMaxVotes` is read by the DO (Task 13) to best-effort write the
// new value through to D1 via ctx.waitUntil.
export function handleSetMaxVotes(
  db: BoardDb,
  actor: Identity,
  p: { n: number },
): ActionResult & { mirrorMaxVotes?: number } {
  if (actor.userId !== db.getMeta().ownerId) return err('forbidden');
  const n = Math.trunc(p.n);
  if (!Number.isInteger(n) || n < 1 || n > LIMITS.maxVotesMax) return err('bad_max_votes');
  db.setMaxVotes(n);
  return { broadcast: [{ type: 'max_votes_changed', maxVotes: n }], mirrorMaxVotes: n };
}
