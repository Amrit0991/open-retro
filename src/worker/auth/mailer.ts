import type { Env } from '../types';

// Sends the magic-link login email via Cloudflare Email Service (the EMAIL send binding).
// No third-party API/secret: the `from` domain must be an onboarded Cloudflare sending domain.
export async function sendMagicLink(env: Env, email: string, url: string): Promise<void> {
  if (env.AUTH_TEST_MODE === '1') return; // tests/local read the token (devUrl) instead of emailing
  await env.EMAIL.send({
    from: `login@${env.DOMAIN}`,
    to: email,
    subject: 'Your open-retro login link',
    html: `<p>Click to sign in:</p><p><a href="${url}">${url}</a></p><p>Expires in 10 minutes.</p>`,
    text: `Sign in to open-retro: ${url}\nExpires in 10 minutes.`,
  });
}
