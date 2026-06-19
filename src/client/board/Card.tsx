import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Card as CardT } from '../../shared/protocol';
import { Icon } from '../ui/icons';

export function Card({
  card,
  columnId,
  index,
  mine,
  canModify,
  onVote,
  onUnvote,
  onDelete,
}: {
  card: CardT;
  columnId: string;
  index: number;
  mine: number;
  canModify: boolean;
  onVote: () => void;
  onUnvote: () => void;
  onDelete: () => void;
}) {
  // Each card is both draggable and a sortable drop target carrying the slot it
  // occupies, so onDragEnd can read the destination column + index off `over`.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { columnId, index },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const initial = (card.authorName || '?').trim().charAt(0).toUpperCase();

  return (
    <div
      ref={setNodeRef}
      className={`card${isDragging ? ' dragging' : ''}`}
      style={style}
      {...attributes}
      {...listeners}
    >
      {canModify && (
        <button className="card-del" aria-label="delete" onClick={onDelete}>
          <Icon name="trash" size={14} />
        </button>
      )}
      <p className="card-text">{card.text}</p>
      <footer className="card-foot">
        <span className="author">
          <span className="avatar">{initial}</span>
          <span className="name">{card.authorName}</span>
        </span>
        <span className={`vote${mine > 0 ? ' mine' : ''}`}>
          <button aria-label="downvote" onClick={onUnvote} disabled={mine === 0}>
            <Icon name="minus" size={15} />
          </button>
          <span className="n" aria-label="votes">
            {card.votes}
          </span>
          <button aria-label="upvote" onClick={onVote}>
            <Icon name="plus" size={15} />
          </button>
        </span>
      </footer>
    </div>
  );
}

// The floating clone rendered in the DragOverlay while a card is held. Static
// (no sortable hooks / buttons) so it tracks the cursor smoothly across columns.
export function CardOverlay({ card }: { card: CardT }) {
  const initial = (card.authorName || '?').trim().charAt(0).toUpperCase();
  return (
    <div className="card card-overlay">
      <p className="card-text">{card.text}</p>
      <footer className="card-foot">
        <span className="author">
          <span className="avatar">{initial}</span>
          <span className="name">{card.authorName}</span>
        </span>
        <span className="vote">
          <span className="n">{card.votes}</span>
        </span>
      </footer>
    </div>
  );
}
