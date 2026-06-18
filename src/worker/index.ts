import { Hono } from 'hono';
import type { Env } from './types';
import { authRoutes } from './auth/routes';

const app = new Hono<{ Bindings: Env }>();
app.get('/api/health', (c) => c.json({ ok: true }));
app.route('/api/auth', authRoutes);

export default app;
