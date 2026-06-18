import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { DndContext, type DragEndEvent } from '@dnd-kit/core';
import { api } from '../api';
import { useSession } from '../auth/useSession';
import { useBoardSocket } from './useBoardSocket';
import { Column } from './Column';
import { computeNeighbors } from './dnd';

export function BoardView() {
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useSession();

  useEffect(() => {
    if (id) api.joinBoard(id).catch(() => {});
  }, [id]);

  const { state, actions } = useBoardSocket(id ?? '');

  if (loading) return <p>Loading…</p>;
  if (!user) return <p>Not signed in.</p>;
  if (!state.ready) return <p>Connecting…</p>;

  const myUserId = user.id;

  const onDragEnd = (e: DragEndEvent) => {
    const cardId = String(e.active.id);
    const toColumnId = String(e.over?.data.current?.columnId ?? e.over?.id ?? '');
    if (!toColumnId) return;
    const targetIndex = Number(
      e.over?.data.current?.index ?? (state.order[toColumnId]?.length ?? 0),
    );
    const without = (state.order[toColumnId] ?? []).filter((x) => x !== cardId);
    const { beforeId, afterId } = computeNeighbors(without, targetIndex);
    actions.moveCard(cardId, toColumnId, beforeId, afterId);
  };

  // Header components (sort toggle, share, max-votes) land in Task 20.
  return (
    <main className="board">
      <DndContext onDragEnd={onDragEnd}>
        <div className="columns">
          {state.columns.map((col) => (
            <Column key={col.id} col={col} state={state} myUserId={myUserId} actions={actions} />
          ))}
        </div>
      </DndContext>
    </main>
  );
}
