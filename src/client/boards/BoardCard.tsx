import { Link } from 'react-router-dom';

export function BoardCard({ board }: { board: { id: string; name: string; template: string } }) {
  return (
    <Link to={`/b/${board.id}`}>
      <div className="board-card">
        <h3>{board.name}</h3>
        <small>{board.template}</small>
      </div>
    </Link>
  );
}
