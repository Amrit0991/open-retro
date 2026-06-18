export interface Env {
  DB: D1Database;
  BOARDROOM: DurableObjectNamespace;
  ASSETS: Fetcher; // Workers Static Assets binding
  RESEND_API_KEY: string;
  APP_ORIGIN: string; // e.g. https://open-retro.example.com (for links + Origin allowlist)
  AUTH_TEST_MODE?: string; // "1" in tests: expose verify URL, skip real email
}
