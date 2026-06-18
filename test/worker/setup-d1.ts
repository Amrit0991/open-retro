import { env } from 'cloudflare:test';
import { beforeAll } from 'vitest';
// Raw schema text imported via Vite's `?raw` suffix so it loads inside the
// workerd test runtime without Node `fs`.
import schemaSql from '../../src/worker/db/schema.sql?raw';

// The pool's test D1 starts empty. Apply the canonical schema once per worker
// before any test runs. Statements are split on `;` and run individually:
// D1's `.exec()` of a multi-statement blob is finicky, whereas prepared
// single statements are reliable. Schema uses `CREATE ... IF NOT EXISTS`, so
// re-applying is safe.
beforeAll(async () => {
  const statements = schemaSql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    await env.DB.prepare(statement).run();
  }
});
