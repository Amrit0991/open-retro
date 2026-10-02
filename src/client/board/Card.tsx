import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Card as CardT } from '../../shared/protocol';
import { LIMITS } from '../../shared/protocol';
import { Icon } from '../ui/icons';
import { toneForUser } from '../ui/tone';

function Author({ card }: { card: CardT }) {
  const initial = (card.authorName || '?').trim().charAt(0).toUpperCase();
  return (
    <span className="author">
      <span className="avatar" data-tone={toneForUser(card.authorId)}>
        {initial}
      </span>
      <span className="name">{card.authorName}</span>
    </span>
  );
}

function CardEditor({ initial, onSave, onCancel }: { initial: string; onSave: (t: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const commit = () => {
    const trimmed = text.trim();
    if (trimmed && trimmed !== initial) onSave(trimmed);
    else onCancel();
  };
  return (
    <textarea
      className="card-edit"
      aria-label="edit card"
      autoFocus
      maxLength={LIMITS.cardText}
      value={text}
      // Keep text selection and caret clicks from starting a card drag.
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') onCancel();
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
    />
  );
}

export function Card({
  card,
  columnId,
  index,
  mine,
  canModify,
  canVote,
  onVote,
  onUnvote,
  onDelete,
  onEdit,
}: {
  card: CardT;
  columnId: string;
  index: number;
  mine: number;
  canModify: boolean;
  canVote: boolean;
  onVote: () => void;
  onUnvote: () => void;
  onDelete: () => void;
  onEdit: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  // Each card is both draggable and a sortable drop target carrying the slot it
  // occupies, so onDragEnd can read the destination column + index off `over`.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { columnId, index },
    disabled: editing,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      className={`card${isDragging ? ' dragging' : ''}${editing ? ' editing' : ''}`}
      style={style}
      {...(editing ? {} : { ...attributes, ...listeners })}
    >
      {canModify && !editing && (
        <span className="card-tools">
          <button aria-label="edit" onClick={() => setEditing(true)}>
            <Icon name="pencil" size={14} />
          </button>
          <button aria-label="delete" onClick={onDelete}>
            <Icon name="trash" size={14} />
          </button>
        </span>
      )}
      {editing ? (
        <CardEditor
          initial={card.text}
          onSave={(t) => {
            onEdit(t);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <p className="card-text" onDoubleClick={canModify ? () => setEditing(true) : undefined}>
          {card.text}
        </p>
      )}
      <footer className="card-foot">
        <Author card={card} />
        <span className={`vote${mine > 0 ? ' mine' : ''}`}>
          <button aria-label="downvote" onClick={onUnvote} disabled={mine === 0}>
            <Icon name="minus" size={15} />
          </button>
          <span className="n" aria-label="votes">
            {card.votes}
          </span>
          <button
            aria-label="upvote"
            onClick={onVote}
            disabled={!canVote}
            title={canVote ? undefined : 'No votes left'}
          >
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
  return (
    <div className="card card-overlay">
      <p className="card-text">{card.text}</p>
      <footer className="card-foot">
        <Author card={card} />
        <span className="vote">
          <span className="n">{card.votes}</span>
        </span>
      </footer>
    </div>
  );
}
