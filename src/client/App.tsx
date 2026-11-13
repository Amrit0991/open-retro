import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useSession } from './auth/useSession';
import { LoginPage } from './auth/LoginPage';
import { api } from './api';
import { BoardListPage } from './boards/BoardList';
import { TemplatesPage } from './templates/TemplatesPage';
import { BoardView } from './board/BoardView';

// Send signed-out users to /login, remembering where they were headed.
function ToLogin() {
  const { pathname } = useLocation();
  return <Navigate to={`/login?next=${encodeURIComponent(pathname)}`} replace />;
}

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
        <Route path="/" element={user ? <BoardListPage /> : <ToLogin />} />
        <Route path="/templates" element={user ? <TemplatesPage /> : <ToLogin />} />
        <Route path="/b/:id" element={user ? <BoardView /> : <ToLogin />} />
      </Routes>
    </BrowserRouter>
  );
}
