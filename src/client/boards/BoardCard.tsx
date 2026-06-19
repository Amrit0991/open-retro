import { Link } from 'react-router-dom';
import { Glyph } from '../ui/Glyph';
import { templateGlyph, templateName } from '../ui/glyphs';

export function BoardCard({
  board,
  index = 0,
}: {
  board: { id: string; name: string; template: string };
  index?: number;
}) {
  const g = templateGlyph(board.template);
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
