import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useSession } from './auth/useSession';
import { LoginPage } from './auth/LoginPage';
import { api } from './api';
import { BoardListPage } from './boards/BoardList'; // Task 18
import { BoardView } from './board/BoardView'; // Task 19

export function App() {
  const { user, loading } = useSession();
  if (loading) return <p>Loading…</p>;
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage requestMagicLink={api.requestMagicLink} />} />
        <Route path="/" element={user ? <BoardListPage /> : <Navigate to="/login" />} />
        <Route path="/b/:id" element={user ? <BoardView /> : <Navigate to="/login" />} />
      </Routes>
    </BrowserRouter>
  );
}
