import { Hono } from 'hono';
import type { Env } from '../types';
import { issueToken } from './tokens';
import { sendMagicLink } from './mailer';

export const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.post('/request', async (c) => {
  const { email } = await c.req
    .json<{ email?: string }>()
    .catch(() => ({ email: undefined }));
  if (email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    const raw = await issueToken(c.env, email);
    const url = `${c.env.APP_ORIGIN}/api/auth/verify?token=${encodeURIComponent(raw)}`;
    try {
      await sendMagicLink(c.env, email, url);
    } catch {
      /* do not leak */
    }
    if (c.env.AUTH_TEST_MODE === '1') return c.json({ ok: true, devUrl: url });
  }
  return c.json({ ok: true }); // uniform response — no enumeration
});
