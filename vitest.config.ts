import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig, defineProject } from 'vitest/config';

// NOTE (resolved at scaffold time): vitest 4.1.9 + @cloudflare/vitest-pool-workers 0.16.17.
// This pool version removed `defineWorkersConfig` and the `test.poolOptions.workers`
// surface. The current API is the `cloudflareTest({ wrangler: { configPath } })` Vite
// plugin used per-project. There are no `singleWorker`/`isolatedStorage` options, so the
// WS project's no-isolate behavior is set in the `test:ws` npm script via
// `--no-isolate --max-workers=1` (see package.json).

// Worker/DO unit + integration tests (per-test isolated storage).
const worker = defineProject({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
  test: {
    name: 'worker',
    include: ['test/worker/**/*.test.ts'],
    exclude: ['test/worker/boardroom.ws.test.ts'],
    // Applies src/worker/db/schema.sql to the (empty) test D1 before each suite.
    setupFiles: ['test/worker/setup-d1.ts'],
  },
});

// WS transport tests: WebSockets are incompatible with per-test storage isolation, so this
// project is run single-worker / no-isolate (via the test:ws CLI flags) with manual cleanup.
const workerWs = defineProject({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
  test: {
    name: 'worker-ws',
    include: ['test/worker/boardroom.ws.test.ts'],
  },
});

// Frontend component tests.
const client = defineProject({
  test: {
    name: 'client',
    include: ['test/client/**/*.{test,spec}.{ts,tsx}'],
    environment: 'happy-dom',
    setupFiles: ['test/client/setup.ts'],
  },
});

export default defineConfig({
  test: { projects: [worker, workerWs, client] },
});
