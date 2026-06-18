import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Card as CardT } from '../../shared/protocol';

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
    opacity: isDragging ? 0.5 : undefined,
  };

  return (
    <div ref={setNodeRef} className="card" style={style} {...attributes} {...listeners}>
      <p>{card.text}</p>
      <footer>
        <span className="author">{card.authorName}</span>
        <button aria-label="downvote" onClick={onUnvote} disabled={mine === 0}>
          −
        </button>
        <span aria-label="votes">{card.votes}</span>
        <button aria-label="upvote" onClick={onVote}>
          +
        </button>
        {canModify && (
          <button aria-label="delete" onClick={onDelete}>
            🗑
          </button>
        )}
      </footer>
    </div>
  );
}
