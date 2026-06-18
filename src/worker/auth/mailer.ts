import type { Env } from '../types';

export async function sendMagicLink(env: Env, email: string, url: string): Promise<void> {
  if (env.AUTH_TEST_MODE === '1') return; // tests read the token from D1 instead
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      // PLACEHOLDER: replace with a Resend-verified domain before deploy.
      from: 'open-retro <login@YOUR_VERIFIED_DOMAIN>',
      to: email,
      subject: 'Your open-retro login link',
      html: `<p>Click to sign in:</p><p><a href="${url}">${url}</a></p><p>Expires in 10 minutes.</p>`,
    }),
  });
  if (!res.ok) throw new Error(`Resend failed: ${res.status}`);
}
