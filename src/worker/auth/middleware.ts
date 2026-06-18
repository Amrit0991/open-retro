import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import type { Env } from '../types';
import { userIdForSession } from './sessions';

// Sets c.var.userId or 401. Use on protected /api groups.
export const requireSession = createMiddleware<{
  Bindings: Env;
  Variables: { userId: string };
}>(async (c, next) => {
  const userId = await userIdForSession(c.env, getCookie(c, 'session'));
  if (!userId) return c.json({ error: 'unauthorized' }, 401);
  c.set('userId', userId);
  await next();
});

// Rejects mutating cross-origin requests (CSRF/CSWSH defense-in-depth).
export const requireOrigin = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const origin = c.req.header('origin');
  if (origin && origin !== c.env.APP_ORIGIN) {
    return c.json({ error: 'forbidden_origin' }, 403);
  }
  await next();
});
