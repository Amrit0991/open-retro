// Post-login return paths. Strict allowlist of in-app routes so `next` can never
// become an open redirect (no schemes, no protocol-relative `//host`, no backslashes).
const ALLOWED = [/^\/b\/[A-Za-z0-9_-]{1,64}$/, /^\/templates$/];

export function safeNextPath(next: unknown): string | null {
  if (typeof next !== 'string') return null;
  return ALLOWED.some((re) => re.test(next)) ? next : null;
}
