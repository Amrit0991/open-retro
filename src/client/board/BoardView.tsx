import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { api } from '../api';
import { useSession } from '../auth/useSession';
import { useBoardSocket } from './useBoardSocket';
import { Column } from './Column';
import { resolveMove } from './dnd';
import { ShareButton } from './ShareButton';
import { SortToggle, useSortByVotes, sortedOrder } from './SortToggle';
import { MaxVotesSetting } from './MaxVotesSetting';
import { Glyph } from '../ui/Glyph';
import { Icon } from '../ui/icons';
import { templateGlyph, templateName } from '../ui/glyphs';

export function BoardView() {
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useSession();
  const [sortOn, toggleSort] = useSortByVotes(id ?? '');

  useEffect(() => {
    if (id) api.joinBoard(id).catch(() => {});
  }, [id]);

  const { state, actions } = useBoardSocket(id ?? '');

  // Require a small pointer movement before a drag starts, so clicking the
  // vote +/− and delete buttons isn't swallowed by the drag listeners.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  if (loading)
    return (
      <div className="app-state">
        <span className="dotting">Loading</span>
      </div>
    );
  if (!user) return <div className="app-state">Not signed in.</div>;
  if (!state.ready)
    return (
      <div className="app-state">
        <span className="dotting">Connecting</span>
      </div>
    );

  const myUserId = user.id;
  const isOwner = state.ownerId === myUserId;
  const view = sortedOrder(state.order, state.cards, sortOn);
  const tpl = state.template ?? '';
  const g = templateGlyph(tpl);

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
    <>
      <header className="board-bar">
        <Link to="/" className="icon-btn" aria-label="Back to boards">
          <Icon name="back" size={18} />
        </Link>
        <div className="title">
          <Glyph tone={g.tone} icon={g.icon} size={30} />
          <div>
            <div className="kicker">Retro board</div>
            <h1>{templateName(tpl)}</h1>
          </div>
        </div>
        <div className="spacer" />
        <SortToggle on={sortOn} toggle={toggleSort} />
        <ShareButton boardId={id ?? ''} />
        {isOwner && <MaxVotesSetting value={state.maxVotes} onChange={actions.setMaxVotes} />}
      </header>
      {/* Drag is disabled while sorted by votes: neighbor ids from vote-order
          would corrupt stored positions. */}
      {sortOn ? (
        columns
      ) : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          {columns}
        </DndContext>
      )}
    </>
  );
}
