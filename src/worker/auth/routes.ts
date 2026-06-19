import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Env } from '../types';
import { issueToken, consumeToken } from './tokens';
import { tooManyRecently } from './rateLimit';
import { sendMagicLink } from './mailer';
import {
  upsertUserByEmail,
  createSession,
  deleteSession,
  setSessionCookie,
  clearSessionCookie,
} from './sessions';

export const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.post('/request', async (c) => {
  const { email } = await c.req
    .json<{ email?: string }>()
    .catch(() => ({ email: undefined }));
  // Silently drop when over the per-email/hour cap — keep uniform response (no enumeration).
  if (email && (await tooManyRecently(c.env, email))) return c.json({ ok: true });
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

authRoutes.get('/verify', async (c) => {
  const token = c.req.query('token'); // do NOT log request.url
  if (!token) return c.redirect('/login?error=invalid', 302);
  const email = await consumeToken(c.env, token);
  if (!email) return c.redirect('/login?error=invalid', 302);
  const userId = await upsertUserByEmail(c.env, email);
  const raw = await createSession(c.env, userId);
  setSessionCookie(c, raw);
  return c.redirect('/', 302); // hardcoded target — no open redirect
});

authRoutes.post('/logout', async (c) => {
  await deleteSession(c.env, getCookie(c, 'session'));
  clearSessionCookie(c);
  return c.json({ ok: true });
});
