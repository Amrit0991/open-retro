import { defineConfig } from '@playwright/test';

// Runs the WHOLE stack against a single `wrangler dev` (LOCAL mode — no Cloudflare
// auth). The local D1 starts empty, so the webServer command applies the schema
// before building + starting the worker. AUTH_TEST_MODE=1 makes /api/auth/request
// return the verify `devUrl` so the specs can log in without real email.
export default defineConfig({
  testDir: './e2e',
  // The two-client realtime spec opens two browsers itself; keep workers serial so
  // the shared wrangler dev / local D1 isn't raced across specs.
  workers: 1,
  fullyParallel: false,
  webServer: {
    command:
      'npx wrangler d1 execute open-retro --local --file=src/worker/db/schema.sql && npm run build && npx wrangler dev --port 8787 --var AUTH_TEST_MODE:1',
    url: 'http://localhost:8787',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: { baseURL: 'http://localhost:8787' },
});
