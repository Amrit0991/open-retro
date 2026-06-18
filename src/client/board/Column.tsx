import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Card } from './Card';
import { AddCardInput } from './AddCardInput';
import type { BoardState } from './reducer';
import type { useBoardSocket } from './useBoardSocket';
import type { ColumnDef } from '../../shared/protocol';

type BoardActions = ReturnType<typeof useBoardSocket>['actions'];

export function Column({
  col,
  state,
  myUserId,
  actions,
  ids: idsProp,
}: {
  col: ColumnDef;
  state: BoardState;
  myUserId: string;
  actions: BoardActions;
  ids?: string[];
}) {
  const ids = idsProp ?? state.order[col.id] ?? [];

  // Column-level droppable so dropping into an empty column (or below the last card,
  // where no card slot is `over`) still resolves a destination column in onDragEnd.
  const { setNodeRef } = useDroppable({ id: col.id, data: { columnId: col.id } });

  return (
    <section ref={setNodeRef} className="column">
      <h2>{col.title}</h2>
      <p>{col.subtitle}</p>
      <AddCardInput onAdd={(t) => actions.addCard(col.id, t)} />
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
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
              onVote={() => actions.vote(id)}
              onUnvote={() => actions.unvote(id)}
              onDelete={() => actions.deleteCard(id)}
            />
          );
        })}
      </SortableContext>
    </section>
  );
}
