import { Link } from 'react-router-dom';
import type { Tone } from '../../shared/protocol';
import { Glyph } from '../ui/Glyph';
import type { IconName } from '../ui/icons';

export function BoardCard({
  board,
  index = 0,
}: {
  board: { id: string; name: string; templateName: string; glyph: { tone: Tone; icon: string } };
  index?: number;
}) {
  return (
    <Link
      to={`/b/${board.id}`}
      className="board-card"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <Glyph tone={board.glyph.tone} icon={board.glyph.icon as IconName} size={36} />
      <h3>{board.name}</h3>
      <div className="meta">{board.templateName}</div>
      <div className="preview" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
    </Link>
  );
}
