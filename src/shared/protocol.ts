export type TemplateId = 'three_little_pigs' | 'sailboat';

export interface ColumnDef { id: string; title: string; subtitle: string; }

export interface Card {
  id: string;          // client-generated UUID
  columnId: string;
  text: string;
  authorId: string;
  authorName: string;
  position: number;
  createdAt: number;
  votes: number;       // total tally across all users
}

export interface BoardSnapshot {
  meta: { template: TemplateId; maxVotes: number; ownerId: string };
  columns: ColumnDef[];
  cards: Card[];
  yourVotes: Record<string, number>;  // cardId -> the requesting user's own count
}

export type ClientMessage =
  | { type: 'add_card'; clientCardId: string; columnId: string; text: string }
  | { type: 'edit_card'; cardId: string; text: string }
  | { type: 'delete_card'; cardId: string }
  | { type: 'move_card'; cardId: string; toColumnId: string; beforeId: string | null; afterId: string | null }
  | { type: 'vote'; cardId: string }
  | { type: 'unvote'; cardId: string }
  | { type: 'set_max_votes'; n: number };

export type ServerMessage =
  | { type: 'init'; snapshot: BoardSnapshot }
  | { type: 'card_added'; card: Card; clientCardId: string }
  | { type: 'card_edited'; cardId: string; text: string }
  | { type: 'card_deleted'; cardId: string }
  | { type: 'card_moved'; cardId: string; columnId: string; position: number }
  | { type: 'cards_reordered'; columnId: string; positions: { id: string; position: number }[] }
  | { type: 'votes_changed'; cardId: string; total: number }
  | { type: 'your_vote'; cardId: string; yourCount: number }   // targeted to the acting socket only
  | { type: 'max_votes_changed'; maxVotes: number }
  | { type: 'error'; code: string; msg: string };

// Result of a pure DO action handler (Task 9+). actor[] go only to the acting socket; broadcast[] to all.
export interface ActionResult { actor?: ServerMessage[]; broadcast?: ServerMessage[]; }

export interface Identity { userId: string; displayName: string; }

export const LIMITS = { cardText: 2000, boardName: 120, maxVotesMax: 99, boardsPerUser: 100 } as const;
