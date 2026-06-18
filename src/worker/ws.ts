import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Env } from './types';
import { userIdForSession } from './auth/sessions';
import { getBoard, isMember } from './boards/repo';

// Authenticated WS upgrade: validate session + origin + existing membership, then
// forward the upgrade into the board's Durable Object with identity/meta headers.
// Authorization is side-effect-free — joining is the separate `POST /:id/join`.
export async function handleWsUpgrade(c: Context<{ Bindings: Env }>): Promise<Response> {
  if (c.req.header('upgrade') !== 'websocket') return c.text('expected websocket', 426);

  const origin = c.req.header('origin');
  if (origin && origin !== c.env.APP_ORIGIN) return c.text('forbidden_origin', 403);

  const userId = await userIdForSession(c.env, getCookie(c, 'session'));
  if (!userId) return c.text('unauthorized', 401);

  const boardId = c.req.param('id');
  if (!boardId) return c.text('not_found', 404);
  const board = await getBoard(c.env, boardId);
  if (!board) return c.text('not_found', 404);
  if (!(await isMember(c.env, boardId, userId))) return c.text('forbidden', 403);

  const user = await c.env.DB.prepare('SELECT display_name FROM users WHERE id=?')
    .bind(userId)
    .first<{ display_name: string }>();

  const stub = c.env.BOARDROOM.get(c.env.BOARDROOM.idFromName(boardId));
  const fwd = new Request(c.req.url, {
    headers: {
      upgrade: 'websocket',
      'x-user-id': userId,
      'x-display-name': user?.display_name ?? 'Someone',
      'x-board-id': boardId,
      'x-template': board.template,
      'x-max-votes': String(board.max_votes),
      'x-owner-id': board.owner_id,
    },
  });
  return stub.fetch(fwd);
}
