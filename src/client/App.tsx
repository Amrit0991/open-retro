import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useSession } from './auth/useSession';
import { LoginPage } from './auth/LoginPage';
import { api } from './api';
import { BoardListPage } from './boards/BoardList';
import { BoardView } from './board/BoardView';

export function App() {
  const { user, loading } = useSession();
  if (loading)
    return (
      <div className="app-state">
        <span className="dotting">Loading</span>
      </div>
    );
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
