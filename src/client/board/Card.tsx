import type { Card as CardT } from '../../shared/protocol';

export function Card({
  card,
  mine,
  canModify,
  onVote,
  onUnvote,
  onDelete,
}: {
  card: CardT;
  mine: number;
  canModify: boolean;
  onVote: () => void;
  onUnvote: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="card">
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
