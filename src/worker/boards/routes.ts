import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSession } from '../auth/middleware';
import { LIMITS, type TemplateId } from '../../shared/protocol';
import { TEMPLATES } from '../../shared/templates';
import * as repo from './repo';

type Vars = { Variables: { userId: string }; Bindings: Env };
export const boardRoutes = new Hono<Vars>();
boardRoutes.use('*', requireSession);

const toJson = (b: repo.BoardRow & { role?: string }) =>
  ({ id: b.id, name: b.name, template: b.template, maxVotes: b.max_votes, ownerId: b.owner_id, createdAt: b.created_at, role: b.role });

boardRoutes.get('/', async (c) => c.json((await repo.listBoardsForUser(c.env, c.get('userId'))).map(toJson)));

boardRoutes.post('/', async (c) => {
  type CreateBody = { name?: string; template?: string; maxVotes?: number };
  const body = await c.req.json<CreateBody>().catch((): CreateBody => ({}));
  const name = (body.name ?? '').trim();
  const template = body.template as TemplateId;
  const maxVotes = Number(body.maxVotes);
  if (!name || name.length > LIMITS.boardName) return c.json({ error: 'bad_name' }, 400);
  if (!(template in TEMPLATES)) return c.json({ error: 'bad_template' }, 400);
  if (!Number.isInteger(maxVotes) || maxVotes < 1 || maxVotes > LIMITS.maxVotesMax) return c.json({ error: 'bad_max_votes' }, 400);
  if (await repo.countBoardsOwnedBy(c.env, c.get('userId')) >= LIMITS.boardsPerUser) return c.json({ error: 'too_many' }, 400);
  const row = await repo.createBoard(c.env, c.get('userId'), name, template, maxVotes);
  return c.json(toJson({ ...row, role: 'owner' }));
});

boardRoutes.get('/:id', async (c) => {
  const board = await repo.getBoard(c.env, c.req.param('id'));
  if (!board || !(await repo.isMember(c.env, board.id, c.get('userId')))) return c.json({ error: 'not_found' }, 404);
  return c.json(toJson(board));
});

boardRoutes.post('/:id/join', async (c) => {
  const board = await repo.getBoard(c.env, c.req.param('id'));
  if (!board) return c.json({ error: 'not_found' }, 404);
  await repo.addMember(c.env, board.id, c.get('userId')); // INSERT OR IGNORE — idempotent
  return c.json({ joined: true });
});
