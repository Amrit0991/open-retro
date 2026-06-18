import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { BoardCard } from './BoardCard';
import { CreateBoardModal } from './CreateBoardModal';

interface BoardSummary {
  id: string;
  name: string;
  template: string;
}

export function BoardListPage() {
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    api.listBoards().then((list) => setBoards(list as BoardSummary[]));
  }, []);

  return (
    <main>
      <header>
        <h1>Your retros</h1>
        <button onClick={() => setOpen(true)}>Add board</button>
      </header>
      <div className="board-grid">
        {boards.map((b) => (
          <BoardCard key={b.id} board={b} />
        ))}
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
    </main>
  );
}
