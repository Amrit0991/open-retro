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
  return (
    <section className="column">
      <h2>{col.title}</h2>
      <p>{col.subtitle}</p>
      <AddCardInput onAdd={(t) => actions.addCard(col.id, t)} />
      {ids.map((id) => {
        const card = state.cards[id];
        if (!card) return null;
        return (
          <Card
            key={id}
            card={card}
            mine={state.yourVotes[id] ?? 0}
            canModify={card.authorId === myUserId || state.ownerId === myUserId}
            onVote={() => actions.vote(id)}
            onUnvote={() => actions.unvote(id)}
            onDelete={() => actions.deleteCard(id)}
          />
        );
      })}
    </section>
  );
}
