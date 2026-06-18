import type { ServerMessage, Card, BoardSnapshot, ColumnDef, TemplateId } from '../../shared/protocol';

export interface BoardState {
  ready: boolean;
  template: TemplateId | null;
  maxVotes: number;
  ownerId: string;
  columns: ColumnDef[];
  cards: Record<string, Card>;
  order: Record<string, string[]>;       // columnId -> cardIds (position order)
  yourVotes: Record<string, number>;
}

export const initialState: BoardState = {
  ready: false, template: null, maxVotes: 0, ownerId: '', columns: [], cards: {}, order: {}, yourVotes: {},
};

type Action =
  | { kind: 'server'; msg: ServerMessage }
  | { kind: 'optimistic_add'; card: Card }
  | { kind: 'reset' };

function rebuildOrder(columns: ColumnDef[], cards: Record<string, Card>): Record<string, string[]> {
  const order: Record<string, string[]> = {};
  for (const c of columns) order[c.id] = [];
  for (const card of Object.values(cards)) (order[card.columnId] ??= []).push(card.id);
  for (const colId of Object.keys(order))
    order[colId].sort((a, b) =>
      cards[a].position - cards[b].position ||
      cards[a].createdAt - cards[b].createdAt ||
      (cards[a].id < cards[b].id ? -1 : 1));
  return order;
}

function fromSnapshot(s: BoardSnapshot): BoardState {
  const cards: Record<string, Card> = {};
  for (const c of s.cards) cards[c.id] = c;
  return {
    ready: true,
    template: s.meta.template,
    maxVotes: s.meta.maxVotes,
    ownerId: s.meta.ownerId,
    columns: s.columns,
    cards,
    order: rebuildOrder(s.columns, cards),
    yourVotes: { ...s.yourVotes },
  };
}

export function reducer(state: BoardState, action: Action): BoardState {
  if (action.kind === 'reset') return initialState;
  if (action.kind === 'optimistic_add') {
    const cards = { ...state.cards, [action.card.id]: action.card };
    return { ...state, cards, order: rebuildOrder(state.columns, cards) };
  }
  const msg = action.msg;
  if (msg.type === 'init') return fromSnapshot(msg.snapshot);
  if (!state.ready) return state; // ignore patches before init

  switch (msg.type) {
    case 'card_added': {
      const cards = { ...state.cards, [msg.card.id]: msg.card }; // upsert-by-id
      return { ...state, cards, order: rebuildOrder(state.columns, cards) };
    }
    case 'card_edited': {
      const cur = state.cards[msg.cardId];
      if (!cur) return state;
      return { ...state, cards: { ...state.cards, [msg.cardId]: { ...cur, text: msg.text } } };
    }
    case 'card_deleted': {
      if (!state.cards[msg.cardId]) return state;
      const cards = { ...state.cards };
      delete cards[msg.cardId];
      const yourVotes = { ...state.yourVotes };
      delete yourVotes[msg.cardId];
      return { ...state, cards, yourVotes, order: rebuildOrder(state.columns, cards) };
    }
    case 'card_moved': {
      const cur = state.cards[msg.cardId];
      if (!cur) return state;
      const cards = { ...state.cards, [msg.cardId]: { ...cur, columnId: msg.columnId, position: msg.position } };
      return { ...state, cards, order: rebuildOrder(state.columns, cards) };
    }
    case 'cards_reordered': {
      const cards = { ...state.cards };
      for (const p of msg.positions) if (cards[p.id]) cards[p.id] = { ...cards[p.id], position: p.position };
      return { ...state, cards, order: rebuildOrder(state.columns, cards) };
    }
    case 'votes_changed': {
      const cur = state.cards[msg.cardId];
      if (!cur) return state;
      return { ...state, cards: { ...state.cards, [msg.cardId]: { ...cur, votes: msg.total } } }; // set, never +=
    }
    case 'your_vote':
      return { ...state, yourVotes: { ...state.yourVotes, [msg.cardId]: msg.yourCount } };
    case 'max_votes_changed':
      return { ...state, maxVotes: msg.maxVotes };
    case 'error':
      return state; // surfaced via the hook's onError, not the reducer
    default:
      return state;
  }
}

export const spentVotes = (s: BoardState): number =>
  Object.values(s.yourVotes).reduce((a, b) => a + b, 0);

export const remainingVotes = (s: BoardState): number =>
  Math.max(0, s.maxVotes - spentVotes(s));
