import { useState } from 'react';
import type { Card } from '../../shared/protocol';

// Pure helper: returns a new order map with each column's ids sorted by votes
// (desc, tie-broken by position asc) when byVotes is true; otherwise returns
// the input order unchanged. Never mutates the input arrays.
export function sortedOrder(
  order: Record<string, string[]>,
  cards: Record<string, Card>,
  byVotes: boolean,
): Record<string, string[]> {
  if (!byVotes) return order;
  const out: Record<string, string[]> = {};
  for (const [col, ids] of Object.entries(order)) {
    out[col] = [...ids].sort(
      (a, b) => cards[b].votes - cards[a].votes || cards[a].position - cards[b].position,
    );
  }
  return out;
}

export function useSortByVotes(boardId: string): [boolean, () => void] {
  const key = `sort-by-votes:${boardId}`;
  const [on, setOn] = useState(() => localStorage.getItem(key) === '1');
  const toggle = () =>
    setOn((v) => {
      localStorage.setItem(key, v ? '0' : '1');
      return !v;
    });
  return [on, toggle];
}

export function SortToggle({ on, toggle }: { on: boolean; toggle: () => void }) {
  return (
    <button type="button" aria-pressed={on} onClick={toggle}>
      Sort by votes: {on ? 'on' : 'off'}
    </button>
  );
}
