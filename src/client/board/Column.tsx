import { useDroppable } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Card } from './Card';
import { AddCardInput } from './AddCardInput';
import { Glyph } from '../ui/Glyph';
import { remainingVotes, type BoardState } from './reducer';
import type { useBoardSocket } from './useBoardSocket';
import type { ColumnDef } from '../../shared/protocol';

type BoardActions = ReturnType<typeof useBoardSocket>['actions'];

export function Column({
  col,
  state,
  myUserId,
  actions,
  ids: idsProp,
  wide = false,
}: {
  col: ColumnDef;
  state: BoardState;
  myUserId: string;
  actions: BoardActions;
  ids?: string[];
  wide?: boolean;
}) {
  const ids = idsProp ?? state.order[col.id] ?? [];
  const canVote = remainingVotes(state) > 0;

  // Column-level droppable so dropping into an empty column (or below the last card,
  // where no card slot is `over`) still resolves a destination column in onDragEnd.
  const { setNodeRef } = useDroppable({ id: col.id, data: { columnId: col.id } });

  return (
    <section ref={setNodeRef} className={`column${wide ? ' column-wide' : ''}`}>
      <div className="col-head">
        <Glyph tone={col.tone} icon={col.icon} size={28} />
        <h2>{col.title}</h2>
        <span className="count">{ids.length}</span>
      </div>
      {col.subtitle && <p className="col-sub">{col.subtitle}</p>}
      <AddCardInput onAdd={(t) => actions.addCard(col.id, t)} />
      <SortableContext items={ids} strategy={wide ? rectSortingStrategy : verticalListSortingStrategy}>
        <div className="col-cards">
        {ids.map((id, index) => {
          const card = state.cards[id];
          if (!card) return null;
          return (
            <Card
              key={id}
              card={card}
              columnId={col.id}
              index={index}
              mine={state.yourVotes[id] ?? 0}
              canModify={card.authorId === myUserId || state.ownerId === myUserId}
              canVote={canVote}
              onVote={() => actions.vote(id)}
              onUnvote={() => actions.unvote(id)}
              onDelete={() => actions.deleteCard(id)}
              onEdit={(text) => actions.editCard(id, text)}
            />
          );
        })}
        </div>
      </SortableContext>
    </section>
  );
}
