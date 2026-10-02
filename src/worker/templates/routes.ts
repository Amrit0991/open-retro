import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSession } from '../auth/middleware';
import { TEMPLATES } from '../../shared/templates';
import type { TemplateSummary } from '../../shared/protocol';
import * as repo from './repo';
import { validateTemplate } from './validate';

type Vars = { Variables: { userId: string }; Bindings: Env };
export const templateRoutes = new Hono<Vars>();
templateRoutes.use('*', requireSession);

const builtins = (): TemplateSummary[] =>
  Object.entries(TEMPLATES).map(([id, t]) => ({ id, name: t.name, glyph: t.glyph, columns: t.columns, readOnly: true }));

templateRoutes.get('/', async (c) =>
  c.json({ builtins: builtins(), custom: await repo.listTemplates(c.env, c.get('userId')) }));

templateRoutes.post('/', async (c) => {
  const v = validateTemplate(await c.req.json().catch(() => ({})));
  if ('error' in v) return c.json(v, 400);
  return c.json(await repo.createTemplate(c.env, c.get('userId'), v.name, v.columns));
});

templateRoutes.put('/:id', async (c) => {
  const v = validateTemplate(await c.req.json().catch(() => ({})));
  if ('error' in v) return c.json(v, 400);
  const ok = await repo.updateTemplate(c.env, c.req.param('id'), c.get('userId'), v.name, v.columns);
  return ok ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
});

templateRoutes.delete('/:id', async (c) => {
  const ok = await repo.deleteTemplate(c.env, c.req.param('id'), c.get('userId'));
  return ok ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
});
