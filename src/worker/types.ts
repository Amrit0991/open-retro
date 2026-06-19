export interface Env {
  DB: D1Database;
  BOARDROOM: DurableObjectNamespace;
  ASSETS: Fetcher; // Workers Static Assets binding
  EMAIL: SendEmail; // Cloudflare Email Service outbound send binding (magic links)
  APP_ORIGIN: string; // e.g. https://open-retro.example.com (for links + Origin allowlist)
  DOMAIN: string; // onboarded Cloudflare sending domain for the magic-link "from" address
  AUTH_TEST_MODE?: string; // "1" in tests/local: expose verify URL, skip real email
}
