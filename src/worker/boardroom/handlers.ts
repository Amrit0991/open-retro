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
