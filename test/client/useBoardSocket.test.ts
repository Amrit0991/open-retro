import { renderHook, act, waitFor } from '@testing-library/react';
import { it, expect } from 'vitest';
import { useBoardSocket } from '../../src/client/board/useBoardSocket';
import type { BoardSnapshot } from '../../src/shared/protocol';

class FakeSocket {
  onopen?: () => void; onmessage?: (e: { data: string }) => void; onclose?: () => void;
  sent: string[] = [];
  constructor(public url: string) { setTimeout(() => this.onopen?.(), 0); }
  send(d: string) { this.sent.push(d); }
  close() { this.onclose?.(); }
  emit(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }); }
}

const snap: BoardSnapshot = { meta: { template: 'three_little_pigs', maxVotes: 3, ownerId: 'o' }, columns: [{ id: 'straws', title: 'S', subtitle: '' }], cards: [], yourVotes: {} };

it('connects, applies init, and optimistic add appears before server echo', async () => {
  let sock!: FakeSocket;
  const { result } = renderHook(() => useBoardSocket('b1', { wsFactory: (url) => (sock = new FakeSocket(url)) as any }));
  await act(async () => { await new Promise((r) => setTimeout(r, 1)); sock.emit({ type: 'init', snapshot: snap }); });
  await waitFor(() => expect(result.current.state.ready).toBe(true));

  act(() => result.current.actions.addCard('straws', 'hello'));
  expect(result.current.state.order.straws).toHaveLength(1);                       // optimistic
  const sent = JSON.parse(sock.sent.at(-1)!);
  expect(sent).toMatchObject({ type: 'add_card', columnId: 'straws', text: 'hello' });
  expect(sent.clientCardId).toBeTruthy();

  act(() => sock.emit({ type: 'card_added', clientCardId: sent.clientCardId, card: { id: sent.clientCardId, columnId: 'straws', text: 'hello', authorId: 'me', authorName: 'Me', position: 1024, createdAt: 1, votes: 0 } }));
  expect(result.current.state.order.straws).toHaveLength(1);                       // still one (deduped)
});
