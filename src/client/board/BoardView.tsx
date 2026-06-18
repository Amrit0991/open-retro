import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { DndContext, type DragEndEvent } from '@dnd-kit/core';
import { api } from '../api';
import { useSession } from '../auth/useSession';
import { useBoardSocket } from './useBoardSocket';
import { Column } from './Column';
import { resolveMove } from './dnd';
import { ShareButton } from './ShareButton';
import { SortToggle, useSortByVotes, sortedOrder } from './SortToggle';
import { MaxVotesSetting } from './MaxVotesSetting';

export function BoardView() {
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useSession();
  const [sortOn, toggleSort] = useSortByVotes(id ?? '');

  useEffect(() => {
    if (id) api.joinBoard(id).catch(() => {});
  }, [id]);

  const { state, actions } = useBoardSocket(id ?? '');

  if (loading) return <p>Loading…</p>;
  if (!user) return <p>Not signed in.</p>;
  if (!state.ready) return <p>Connecting…</p>;

  const myUserId = user.id;
  const isOwner = state.ownerId === myUserId;
  const view = sortedOrder(state.order, state.cards, sortOn);

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over) return;
    const cardId = String(e.active.id);
    const over = e.over.data.current as { columnId?: string; index?: number } | undefined;
    // `over` is a card slot → { columnId, index }; or a column droppable → { columnId } only.
    // Fall back to the over node's id when no data is attached (defensive).
    const toColumnId = over?.columnId ?? String(e.over.id);
    // No index ⇒ dropped on the column droppable (empty col / below last card) ⇒ tail (null).
    const overIndex = typeof over?.index === 'number' ? over.index : null;
    const { beforeId, afterId } = resolveMove(state.order, cardId, toColumnId, overIndex);
    actions.moveCard(cardId, toColumnId, beforeId, afterId);
  };

  const columns = (
    <div className="columns">
      {state.columns.map((col) => (
        <Column
          key={col.id}
          col={col}
          state={state}
          myUserId={myUserId}
          actions={actions}
          ids={view[col.id]}
        />
      ))}
    </div>
  );

  return (
    <main className="board">
      <header className="board-header">
        <ShareButton boardId={id ?? ''} />
        <SortToggle on={sortOn} toggle={toggleSort} />
        {isOwner && <MaxVotesSetting value={state.maxVotes} onChange={actions.setMaxVotes} />}
      </header>
      {/* Drag is disabled while sorted by votes: neighbor ids from vote-order
          would corrupt stored positions. */}
      {sortOn ? columns : <DndContext onDragEnd={onDragEnd}>{columns}</DndContext>}
    </main>
  );
}
