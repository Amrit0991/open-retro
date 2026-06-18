import { Hono } from 'hono';
import type { Env } from './types';
import { authRoutes } from './auth/routes';
import { requireOrigin, requireSession } from './auth/middleware';

const app = new Hono<{ Bindings: Env }>();

// Origin guard runs BEFORE handlers on mutating /api requests (GET/HEAD exempt).
app.use('/api/*', async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return requireOrigin(c, next);
  await next();
});

app.get('/api/health', (c) => c.json({ ok: true }));
app.route('/api/auth', authRoutes);

// Stub — replaced with full CRUD in Task 7. Guards the /api group with requireSession.
app.get('/api/boards', requireSession, (c) => c.json([]));

export default app;
