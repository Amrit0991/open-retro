import { Hono } from 'hono';
import type { Env } from './types';
import { authRoutes } from './auth/routes';
import { requireOrigin, requireSession } from './auth/middleware';
import { boardRoutes } from './boards/routes';
import { handleWsUpgrade } from './ws';

const app = new Hono<{ Bindings: Env }>();

// Origin guard runs BEFORE handlers on mutating /api requests (GET/HEAD exempt).
app.use('/api/*', async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return requireOrigin(c, next);
  await next();
});

app.get('/api/health', (c) => c.json({ ok: true }));
app.route('/api/auth', authRoutes);

// Session probe for the SPA — returns the current user or 401.
app.get('/api/me', requireSession, async (c) => {
  const u = await c.env.DB.prepare('SELECT id,email,display_name FROM users WHERE id=?')
    .bind(c.get('userId'))
    .first();
  return c.json(u);
});
// Specific WS path must match BEFORE the generic /api/boards group (which has its own
// session middleware). The ws handler does its own session + origin + membership checks.
app.get('/api/boards/:id/ws', (c) => handleWsUpgrade(c));
app.route('/api/boards', boardRoutes);

export default app;

// Durable Object — must be exported from the worker entry so the runtime/pool
// can instantiate the `BoardRoom` class bound as BOARDROOM in wrangler.jsonc.
export { BoardRoom } from './boardroom/boardroom';
