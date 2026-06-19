import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { BoardCard } from './BoardCard';
import { CreateBoardModal } from './CreateBoardModal';
import { Glyph } from '../ui/Glyph';
import { Icon } from '../ui/icons';

interface BoardSummary {
  id: string;
  name: string;
  template: string;
}

export function BoardListPage() {
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    api
      .listBoards()
      .then((list) => setBoards(list as BoardSummary[]))
      .catch(() => setLoadError(true))
      .finally(() => setLoaded(true));
  }, []);

  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">
          <Glyph tone="green" icon="layers" size={28} />
          <span className="wordmark">
            <b>open</b>
            <span>-retro</span>
          </span>
        </Link>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => setOpen(true)}>
          <span className="icon-c">
            <Icon name="plus" size={16} />
          </span>
          Add board
        </button>
      </header>

      <div className="page">
        <div className="page-head">
          <div>
            <h1>Your retros</h1>
            <div className="sub">
              {boards.length === 0 ? 'No boards yet' : `${boards.length} board${boards.length === 1 ? '' : 's'}`}
            </div>
          </div>
        </div>

        {loadError && (
          <p className="alert" role="alert">
            Couldn't load your boards. Refresh to try again.
          </p>
        )}

        {loaded && !loadError && boards.length === 0 ? (
          <button className="add-card-cta" onClick={() => setOpen(true)} style={{ minHeight: 180 }}>
            <Glyph tone="green" icon="plus" size={40} />
            New board
          </button>
        ) : (
          <div className="board-grid">
            {boards.map((b, i) => (
              <BoardCard key={b.id} board={b} index={i} />
            ))}
            {boards.length > 0 && (
              <button
                className="add-card-cta"
                onClick={() => setOpen(true)}
                style={{ animation: 'rise .5s cubic-bezier(.2,.8,.2,1) both', animationDelay: `${boards.length * 40}ms` }}
              >
                <Glyph tone="slate" icon="plus" size={34} />
                New board
              </button>
            )}
          </div>
        )}
      </div>

      {open && (
        <CreateBoardModal
          onClose={() => setOpen(false)}
          onCreate={async (b) => {
            const created = (await api.createBoard(b)) as { id: string };
            nav(`/b/${created.id}`);
            return created;
          }}
        />
      )}
    </>
  );
}
