const json = (r: Response) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))));
const h = { 'content-type': 'application/json' };

export const api = {
  requestMagicLink: (email: string) =>
    fetch('/api/auth/request', { method: 'POST', headers: h, body: JSON.stringify({ email }) }).then(
      () => {},
    ),
  me: () => fetch('/api/me').then((r) => (r.ok ? r.json() : null)),
  listBoards: () => fetch('/api/boards').then(json),
  createBoard: (b: { name: string; template: string; maxVotes: number }) =>
    fetch('/api/boards', { method: 'POST', headers: h, body: JSON.stringify(b) }).then(json),
  getBoard: (id: string) => fetch(`/api/boards/${id}`).then(json),
  joinBoard: (id: string) =>
    fetch(`/api/boards/${id}/join`, { method: 'POST', headers: h }).then(json),
  logout: () => fetch('/api/auth/logout', { method: 'POST', headers: h }).then(() => {}),
};
