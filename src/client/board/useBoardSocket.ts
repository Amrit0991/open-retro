import { useEffect, useMemo, useReducer, useRef } from 'react';
import { reducer, initialState } from './reducer';
import type { ClientMessage, ServerMessage } from '../../shared/protocol';

export interface WebSocketLike {
  send(d: string): void;
  close(): void;
  onopen?: (() => void) | null;
  onclose?: (() => void) | null;
  onmessage?: ((e: { data: string }) => void) | null;
}

export interface BoardSocketOptions {
  wsFactory?: (url: string) => WebSocketLike;
  onError?: (m: { code: string; msg: string }) => void;
}

const MAX_BACKOFF_MS = 10000;

export function useBoardSocket(boardId: string, opts?: BoardSocketOptions) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const sockRef = useRef<WebSocketLike | null>(null);
  // Keep latest callbacks in refs so the connect effect needn't re-run on opts identity changes.
  const onErrorRef = useRef(opts?.onError);
  const factoryRef = useRef(opts?.wsFactory);
  onErrorRef.current = opts?.onError;
  factoryRef.current = opts?.wsFactory;

  useEffect(() => {
    let closed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const factory = factoryRef.current ?? ((u: string) => new WebSocket(u) as unknown as WebSocketLike);
    const url = `${location.origin.replace(/^http/, 'ws')}/api/boards/${boardId}/ws`;

    const connect = () => {
      const sock = factory(url);
      sockRef.current = sock;
      sock.onopen = () => { attempt = 0; };
      sock.onmessage = (e) => {
        const msg = JSON.parse(e.data) as ServerMessage;
        if (msg.type === 'error') onErrorRef.current?.({ code: msg.code, msg: msg.msg });
        dispatch({ kind: 'server', msg }); // init (incl. on reconnect) replaces state
      };
      sock.onclose = () => {
        if (closed) return;
        const delay = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
        attempt += 1;
        timer = setTimeout(connect, delay);
      };
    };
    connect();

    return () => {
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      sockRef.current?.close();
    };
  }, [boardId]);

  const send = (m: ClientMessage) => sockRef.current?.send(JSON.stringify(m));

  const actions = useMemo(() => ({
    addCard(columnId: string, text: string) {
      const clientCardId = crypto.randomUUID();
      dispatch({
        kind: 'optimistic_add',
        card: {
          id: clientCardId,
          columnId,
          text,
          authorId: 'me',
          authorName: 'You',
          position: Number.MAX_SAFE_INTEGER,
          createdAt: Date.now(),
          votes: 0,
        },
      });
      send({ type: 'add_card', clientCardId, columnId, text });
    },
    editCard: (cardId: string, text: string) => send({ type: 'edit_card', cardId, text }),
    deleteCard: (cardId: string) => send({ type: 'delete_card', cardId }),
    moveCard: (cardId: string, toColumnId: string, beforeId: string | null, afterId: string | null) =>
      send({ type: 'move_card', cardId, toColumnId, beforeId, afterId }),
    vote: (cardId: string) => send({ type: 'vote', cardId }),
    unvote: (cardId: string) => send({ type: 'unvote', cardId }),
    setMaxVotes: (n: number) => send({ type: 'set_max_votes', n }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [boardId]);

  return { state, actions };
}
