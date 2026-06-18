import { Hono } from 'hono';
import type { Env } from './types';
import { authRoutes } from './auth/routes';
import { requireOrigin } from './auth/middleware';
import { boardRoutes } from './boards/routes';

const app = new Hono<{ Bindings: Env }>();

// Origin guard runs BEFORE handlers on mutating /api requests (GET/HEAD exempt).
app.use('/api/*', async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return requireOrigin(c, next);
  await next();
});

app.get('/api/health', (c) => c.json({ ok: true }));
app.route('/api/auth', authRoutes);
app.route('/api/boards', boardRoutes);

export default app;
