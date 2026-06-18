// Ambient types for the worker test project.
//
// 1. Pull in the `cloudflare:test` module declarations shipped by the pool.
// 2. Augment `Cloudflare.Env` (what `import { env } from 'cloudflare:test'`
//    resolves to) so `env.DB` and the other bindings are typed from our `Env`.
// 3. Declare `*.sql?raw` imports as strings (Vite resolves them at runtime).

/// <reference types="@cloudflare/vitest-pool-workers/types" />

import type { Env as WorkerEnv } from '../../src/worker/types';

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}
