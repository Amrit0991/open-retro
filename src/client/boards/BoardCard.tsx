import { Link } from 'react-router-dom';
import { TEMPLATES } from '../../shared/templates';
import type { Tone } from '../../shared/protocol';
import { Glyph } from '../ui/Glyph';
import { templateName } from '../ui/glyphs';

export function BoardCard({
  board,
  index = 0,
}: {
  board: { id: string; name: string; template: string };
  index?: number;
}) {
  // Temporary: glyph from the built-in template by id (Task 5 switches to server-resolved board.glyph).
  const g: { tone: Tone; icon: string } =
    (TEMPLATES as Record<string, { glyph: { tone: Tone; icon: string } }>)[board.template]?.glyph ?? {
      tone: 'slate',
      icon: 'layers',
    };
  return (
    <Link
      to={`/b/${board.id}`}
      className="board-card"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <Glyph tone={g.tone} icon={g.icon} size={36} />
      <h3>{board.name}</h3>
      <div className="meta">{templateName(board.template)}</div>
      <div className="preview" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
    </Link>
  );
}
