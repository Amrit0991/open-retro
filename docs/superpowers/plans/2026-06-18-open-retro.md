# open-retro Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a small real-time collaborative retrospective board (EasyRetro clone) on Cloudflare: Vite React SPA + Worker + one SQLite-backed `BoardRoom` Durable Object per board + D1 for auth/registry + Resend magic links.

**Architecture:** A single Worker serves the SPA (Workers Static Assets), exposes `/api/*` (Hono router: auth, board CRUD, join), and upgrades `GET /api/boards/:id/ws` into the board's Durable Object after validating session + origin + membership against D1. The DO owns all live board state in its embedded SQLite, validates every action in a **no-await synchronous critical section**, and broadcasts patches over hibernatable WebSockets. The DO trusts only Worker-attached identity.

**Tech Stack:** TypeScript, Vite + React 19 + React Router 7 + @dnd-kit, Hono (Worker routing), Cloudflare Workers / Durable Objects (SQLite) / D1, Resend, Vitest + @cloudflare/vitest-pool-workers (Worker/DO) + happy-dom + @testing-library/react (frontend), Playwright (E2E).

Full design spec: [`docs/superpowers/specs/2026-06-18-open-retro-design.md`](../specs/2026-06-18-open-retro-design.md).

## Global Constraints

These apply to **every** task. Exact values:

- **Package manager:** `npm`. **Test runner:** Vitest only — this project is **not** bun:test. Keep Worker/DO tests (vitest-pool-workers) and frontend tests (happy-dom) in separate Vitest configs/projects.
- **Plan target:** Cloudflare Workers **Paid** plan. **DO migration must use `new_sqlite_classes: ["BoardRoom"]`** — never `new_classes` (retired KV backend, not convertible).
- **DO atomicity invariant:** every action does read → validate → write via the **synchronous** `ctx.storage.sql.exec` with **NO `await` between the read and the write**. Any awaited non-storage I/O (D1, fetch) happens *after* the synchronous critical section. The DO keeps **no authoritative in-memory state** (enumerate sockets via `ctx.getWebSockets()`, identity via `ws.deserializeAttachment()`, tallies recomputed from SQL).
- **Identity:** the DO derives `userId`/`displayName`/`ownerId` only from the socket attachment / seeded meta — **never** from a client message body. A forged `author_id` in a payload is ignored.
- **Secrets:** `RESEND_API_KEY` via `wrangler secret put`, never committed. Local dev secrets in `.dev.vars` (gitignored).
- **Auth:** store **SHA-256 hashes** of session ids and magic tokens in D1 (never raw). Magic tokens are single-use (atomic consume) + short-lived. Session cookie: `HttpOnly; Secure; SameSite=Lax; Path=/`. Validate the `Origin` header on every mutating `/api` request and on the WS upgrade.
- **Ordering:** card lists always `ORDER BY position, created_at, id`. Initial positions seeded with gaps of `1024`.
- **Commit style:** conventional commits (`feat:`, `test:`, `chore:`, `docs:`). Commit at the end of every task. Sign-off footer is not required for this repo.
- **Pin versions:** after `npm i`, record the resolved `@cloudflare/vitest-pool-workers` + `vitest` pair in `package.json` (the pool dictates the Vitest major). Verify against the installed version whether the integration-test entry is `SELF` (cloudflare:test) or `exports` (cloudflare:workers) — newer pools use `exports`, which does **not** serve Static Assets (assert SPA serving via Playwright, not the pool).

---

## Shared Protocol (defined once, referenced everywhere)

Created in **Task 2**. Every later task imports these exact names from `src/shared/protocol.ts`. Reproduced here so tasks can be read out of order.

```typescript
export type TemplateId = 'three_little_pigs' | 'sailboat';

export interface ColumnDef { id: string; title: string; subtitle: string; }

export interface Card {
  id: string;          // client-generated UUID
  columnId: string;
  text: string;
  authorId: string;
  authorName: string;
  position: number;
  createdAt: number;
  votes: number;       // total tally across all users
}

export interface BoardSnapshot {
  meta: { template: TemplateId; maxVotes: number; ownerId: string };
  columns: ColumnDef[];
  cards: Card[];
  yourVotes: Record<string, number>;  // cardId -> the requesting user's own count
}

export type ClientMessage =
  | { type: 'add_card'; clientCardId: string; columnId: string; text: string }
  | { type: 'edit_card'; cardId: string; text: string }
  | { type: 'delete_card'; cardId: string }
  | { type: 'move_card'; cardId: string; toColumnId: string; beforeId: string | null; afterId: string | null }
  | { type: 'vote'; cardId: string }
  | { type: 'unvote'; cardId: string }
  | { type: 'set_max_votes'; n: number };

export type ServerMessage =
  | { type: 'init'; snapshot: BoardSnapshot }
  | { type: 'card_added'; card: Card; clientCardId: string }
  | { type: 'card_edited'; cardId: string; text: string }
  | { type: 'card_deleted'; cardId: string }
  | { type: 'card_moved'; cardId: string; columnId: string; position: number }
  | { type: 'cards_reordered'; columnId: string; positions: { id: string; position: number }[] }
  | { type: 'votes_changed'; cardId: string; total: number }
  | { type: 'your_vote'; cardId: string; yourCount: number }   // targeted to the acting socket only
  | { type: 'max_votes_changed'; maxVotes: number }
  | { type: 'error'; code: string; msg: string };

// Result of a pure DO action handler (Task 9+). actor[] go only to the acting socket; broadcast[] to all.
export interface ActionResult { actor?: ServerMessage[]; broadcast?: ServerMessage[]; }

export interface Identity { userId: string; displayName: string; }

export const LIMITS = { cardText: 2000, boardName: 120, maxVotesMax: 99, boardsPerUser: 100 } as const;
```

Templates, created in **Task 2** (`src/shared/templates.ts`):

```typescript
import type { TemplateId, ColumnDef } from './protocol';

export const TEMPLATES: Record<TemplateId, { name: string; columns: ColumnDef[] }> = {
  three_little_pigs: {
    name: 'Three Little Pigs',
    columns: [
      { id: 'straws', title: 'House of Straws', subtitle: 'Things that could easily fall apart' },
      { id: 'sticks', title: 'House of Sticks', subtitle: 'Things that are working but could be improved' },
      { id: 'bricks', title: 'House of Bricks', subtitle: 'Things that are strong and stable' },
    ],
  },
  sailboat: {
    name: 'Sailboat',
    columns: [
      { id: 'wind', title: 'Wind', subtitle: 'What is pushing us forward' },
      { id: 'anchors', title: 'Anchors', subtitle: 'What is holding us back' },
      { id: 'rocks', title: 'Rocks', subtitle: 'Risks ahead of us' },
      { id: 'island', title: 'Island', subtitle: 'Our goals and ideal destination' },
    ],
  },
};
```

`Env` bindings type, created in **Task 1** (`src/worker/types.ts`):

```typescript
export interface Env {
  DB: D1Database;
  BOARDROOM: DurableObjectNamespace;
  ASSETS: Fetcher;                 // Workers Static Assets binding
  RESEND_API_KEY: string;
  APP_ORIGIN: string;              // e.g. https://open-retro.example.com (for links + Origin allowlist)
  AUTH_TEST_MODE?: string;         // "1" in tests: expose verify URL, skip real email
}
```

---

## File Structure

```
open-retro/
  package.json, tsconfig.json, tsconfig.node.json
  wrangler.jsonc
  vite.config.ts
  vitest.config.ts            # Worker/DO project (pool-workers) + frontend project (happy-dom)
  index.html                  # Vite entry -> /src/client/main.tsx
  .dev.vars                   # local secrets (gitignored)
  src/
    shared/
      protocol.ts             # all client<->server types (Task 2)
      templates.ts            # template column defs (Task 2)
    worker/
      index.ts                # Hono app + default export + `export { BoardRoom }` (Task 3,14)
      types.ts                # Env (Task 1)
      db/schema.sql           # D1 DDL (Task 4)
      auth/
        crypto.ts             # randomToken, sha256Hex (Task 5)
        tokens.ts             # issue/consume magic tokens in D1 (Task 5)
        sessions.ts           # create/lookup/delete session, cookie helpers (Task 6)
        mailer.ts             # Resend send + test capture (Task 5,22)
        rateLimit.ts          # D1 per-email/hour counter (Task 22)
        routes.ts             # /api/auth/* (Task 5,6)
        middleware.ts         # requireSession, requireOrigin (Task 6)
      boards/
        repo.ts               # D1 queries for boards + members (Task 7)
        routes.ts             # /api/boards CRUD + join (Task 7,8)
      boardroom/
        boardroom.ts          # the DO: WS accept, hibernation, broadcast, seed (Task 13,14)
        boarddb.ts            # SQLite wrapper (seed, vote SQL, move, snapshot) (Task 9-12)
        handlers.ts           # socket-independent action methods (Task 9-12)
      ws.ts                   # upgrade routing Worker->DO (Task 14)
    client/
      main.tsx, App.tsx       # router (Task 17)
      api.ts                  # fetch wrappers (Task 17)
      auth/{LoginPage.tsx,useSession.ts} (Task 17)
      boards/{BoardList.tsx,BoardCard.tsx,CreateBoardModal.tsx} (Task 18)
      board/
        reducer.ts            # pure reducer over ServerMessage (Task 15)
        useBoardSocket.ts     # WS hook + optimistic senders (Task 16)
        BoardView.tsx, Column.tsx, Card.tsx, AddCardInput.tsx (Task 19)
        SortToggle.tsx, ShareButton.tsx, MaxVotesSetting.tsx (Task 20)
        dnd.ts                # neighbor computation for move_card (Task 19)
  test/
    worker/{auth.test.ts,boards.test.ts,boardroom.handlers.test.ts,boardroom.ws.test.ts}
    client/{reducer.test.ts,useBoardSocket.test.ts,components.test.tsx}
  e2e/{golden-path.spec.ts,two-client.spec.ts}
  playwright.config.ts        # (Task 24)
```

---

## Task 1: Project scaffold & tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `wrangler.jsonc`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `src/client/main.tsx`, `src/worker/types.ts`, `.dev.vars`, `.gitignore` (exists)

**Interfaces:**
- Produces: `Env` interface (see Shared section); npm scripts `dev`, `build`, `test`, `test:ws`, `test:client`.

- [ ] **Step 1: Init package and install deps**

```bash
cd open-retro
npm init -y
npm i hono react react-dom react-router-dom @dnd-kit/core @dnd-kit/sortable
npm i -D typescript vite @vitejs/plugin-react wrangler @cloudflare/workers-types \
  vitest @cloudflare/vitest-pool-workers happy-dom @testing-library/react @testing-library/user-event \
  @testing-library/jest-dom @playwright/test
```

After install, open `package.json` and record the resolved `vitest` + `@cloudflare/vitest-pool-workers` versions in a comment or commit message (Global Constraints).

- [ ] **Step 2: Write `package.json` scripts**

```json
{
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "build": "vite build",
    "typecheck": "tsc -b",
    "test": "vitest run --project worker",
    "test:ws": "vitest run --project worker-ws",
    "test:client": "vitest run --project client",
    "e2e": "playwright test"
  }
}
```

- [ ] **Step 3: Write `wrangler.jsonc`**

```jsonc
{
  "name": "open-retro",
  "main": "src/worker/index.ts",
  "compatibility_date": "2025-04-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "durable_objects": {
    "bindings": [{ "name": "BOARDROOM", "class_name": "BoardRoom" }]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["BoardRoom"] }
  ],
  "d1_databases": [
    { "binding": "DB", "database_name": "open-retro", "database_id": "PLACEHOLDER_RUN_WRANGLER_D1_CREATE" }
  ],
  "vars": { "APP_ORIGIN": "http://localhost:8787" }
}
```

Then create the D1 database and paste its id:
```bash
npx wrangler d1 create open-retro   # copy the database_id into wrangler.jsonc
```

- [ ] **Step 4: Write `tsconfig.json`, `vite.config.ts`, `index.html`, minimal `src/client/main.tsx`, `src/worker/types.ts`**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"], "jsx": "react-jsx",
    "strict": true, "noUnusedLocals": true, "skipLibCheck": true,
    "types": ["@cloudflare/workers-types"], "esModuleInterop": true
  },
  "include": ["src", "test"]
}
```

`vite.config.ts`:
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], build: { outDir: 'dist' } });
```

`index.html`:
```html
<!doctype html><html><head><meta charset="utf-8"><title>open-retro</title></head>
<body><div id="root"></div><script type="module" src="/src/client/main.tsx"></script></body></html>
```

`src/client/main.tsx`:
```tsx
import { createRoot } from 'react-dom/client';
createRoot(document.getElementById('root')!).render(<h1>open-retro</h1>);
```

`src/worker/types.ts`: the `Env` interface from the Shared section above.

- [ ] **Step 5: Write `vitest.config.ts` with three projects**

```typescript
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
import { defineConfig } from 'vitest/config';

const worker = defineWorkersConfig({
  test: {
    name: 'worker',
    include: ['test/worker/**/*.test.ts'],
    exclude: ['test/worker/boardroom.ws.test.ts'],
    poolOptions: { workers: { wrangler: { configPath: './wrangler.jsonc' } } },
  },
});

// WS transport tests: WebSockets are incompatible with per-test storage isolation,
// so this project runs single-worker / no-isolate with manual cleanup.
const workerWs = defineWorkersConfig({
  test: {
    name: 'worker-ws',
    include: ['test/worker/boardroom.ws.test.ts'],
    poolOptions: { workers: { singleWorker: true, isolatedStorage: false, wrangler: { configPath: './wrangler.jsonc' } } },
  },
});

const client = defineConfig({
  test: { name: 'client', include: ['test/client/**/*.{test,spec}.{ts,tsx}'], environment: 'happy-dom', setupFiles: ['test/client/setup.ts'] },
});

export default { ...worker, test: { ...worker.test, projects: [worker, workerWs, client] } } as any;
```

> Note: the exact `poolOptions` keys for no-isolate (`singleWorker`/`isolatedStorage`) depend on the installed pool version — verify against its docs at install time (some versions removed these and require the CLI `--no-isolate`/`--max-workers=1`). If the keys are unavailable, set `test:ws` script to `vitest run --project worker-ws --no-isolate --max-workers=1` and drop the options here.

`test/client/setup.ts`:
```typescript
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 6: Verify build + commit**

Run: `npm run build` → Expected: Vite builds `dist/index.html`. Run: `npx tsc -b` → Expected: no errors.

```bash
git add -A && git commit -m "chore: scaffold vite+worker project with vitest projects and wrangler config"
```

---

## Task 2: Shared protocol & templates

**Files:**
- Create: `src/shared/protocol.ts`, `src/shared/templates.ts`
- Test: `test/worker/templates.test.ts`

**Interfaces:**
- Produces: all types in the Shared Protocol section; `TEMPLATES` map; `LIMITS`.

- [ ] **Step 1: Write the failing test**

```typescript
// test/worker/templates.test.ts
import { describe, it, expect } from 'vitest';
import { TEMPLATES } from '../../src/shared/templates';

describe('templates', () => {
  it('three_little_pigs has 3 columns with stable ids', () => {
    expect(TEMPLATES.three_little_pigs.columns.map(c => c.id)).toEqual(['straws', 'sticks', 'bricks']);
  });
  it('sailboat has 4 columns', () => {
    expect(TEMPLATES.sailboat.columns).toHaveLength(4);
    expect(TEMPLATES.sailboat.columns[0].id).toBe('wind');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- templates` → Expected: FAIL (cannot find module `templates`).

- [ ] **Step 3: Implement `protocol.ts` and `templates.ts`**

Copy the `protocol.ts` and `templates.ts` content verbatim from the **Shared Protocol** section above.

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- templates` → Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared test/worker/templates.test.ts && git commit -m "feat: shared protocol types and retro templates"
```

---

## Task 3: D1 schema & migration runner

**Files:**
- Create: `src/worker/db/schema.sql`, `src/worker/index.ts` (minimal Hono app)
- Test: `test/worker/schema.test.ts`

**Interfaces:**
- Produces: D1 tables `users, sessions, magic_tokens, boards, board_members`; default export Hono `app`.

- [ ] **Step 1: Write `src/worker/db/schema.sql`**

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS magic_tokens (
  token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at INTEGER NOT NULL,
  consumed_at INTEGER, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_magic_email_created ON magic_tokens (email, created_at);
CREATE TABLE IF NOT EXISTS boards (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL,
  template TEXT NOT NULL, max_votes INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS board_members (
  board_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, joined_at INTEGER NOT NULL,
  PRIMARY KEY (board_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON board_members (user_id);
```

- [ ] **Step 2: Write minimal `src/worker/index.ts`**

```typescript
import { Hono } from 'hono';
import type { Env } from './types';

const app = new Hono<{ Bindings: Env }>();
app.get('/api/health', (c) => c.json({ ok: true }));

export default app;
```

- [ ] **Step 3: Apply schema locally and write the failing test**

```bash
npx wrangler d1 execute open-retro --local --file=src/worker/db/schema.sql
```

```typescript
// test/worker/schema.test.ts
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('schema', () => {
  it('boards table exists', async () => {
    const r = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='boards'").first();
    expect(r?.name).toBe('boards');
  });
});
```

> The pool applies migrations/schema from wrangler config to the test D1. If the test D1 starts empty, add a `test/worker/setup-d1.ts` setup file that runs the schema with `await env.DB.exec(schemaSql)` in `beforeAll`. Wire it via `setupFiles` on the `worker` project. Confirm the approach against the installed pool version.

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- schema` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/worker test/worker/schema.test.ts && git commit -m "feat: D1 schema and minimal worker entry"
```

---

## Task 4: Auth crypto helpers

**Files:**
- Create: `src/worker/auth/crypto.ts`
- Test: `test/worker/crypto.test.ts`

**Interfaces:**
- Produces: `randomToken(): string` (≥128-bit base64url), `sha256Hex(input: string): Promise<string>`.

- [ ] **Step 1: Write the failing test**

```typescript
// test/worker/crypto.test.ts
import { describe, it, expect } from 'vitest';
import { randomToken, sha256Hex } from '../../src/worker/auth/crypto';

describe('crypto', () => {
  it('randomToken is long and unique', () => {
    const a = randomToken(), b = randomToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(22); // 16 bytes base64url
  });
  it('sha256Hex is deterministic 64-hex', async () => {
    expect(await sha256Hex('x')).toBe(await sha256Hex('x'));
    expect(await sha256Hex('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- crypto` → Expected: FAIL (module not found).

- [ ] **Step 3: Implement `crypto.ts`**

```typescript
export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 4: Run to verify pass** — Run: `npm test -- crypto` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/worker/auth/crypto.ts test/worker/crypto.test.ts && git commit -m "feat: auth crypto helpers (random token, sha256)"
```

---

## Task 5: Magic-token issue/consume + request route

**Files:**
- Create: `src/worker/auth/tokens.ts`, `src/worker/auth/mailer.ts`, `src/worker/auth/routes.ts`
- Modify: `src/worker/index.ts` (mount `/api/auth`)
- Test: `test/worker/auth.test.ts`

**Interfaces:**
- Consumes: `randomToken`, `sha256Hex` (Task 4); `Env` (Task 1).
- Produces: `issueToken(env, email): Promise<string>` (returns raw token), `consumeToken(env, rawToken): Promise<string | null>` (returns email or null), `sendMagicLink(env, email, url): Promise<void>`. Route `POST /api/auth/request`.

- [ ] **Step 1: Write the failing tests**

```typescript
// test/worker/auth.test.ts (part 1)
import { env, SELF } from 'cloudflare:test'; // if pool uses `exports`, import { exports as SELF } accordingly
import { describe, it, expect, beforeEach } from 'vitest';
import { issueToken, consumeToken } from '../../src/worker/auth/tokens';

beforeEach(async () => {
  await env.DB.exec('DELETE FROM magic_tokens'); await env.DB.exec('DELETE FROM users');
  await env.DB.exec('DELETE FROM sessions');
});

describe('magic tokens', () => {
  it('issues then consumes exactly once', async () => {
    const raw = await issueToken(env, 'a@b.com');
    expect(await consumeToken(env, raw)).toBe('a@b.com');
    expect(await consumeToken(env, raw)).toBeNull(); // single-use
  });
  it('rejects unknown/expired token', async () => {
    expect(await consumeToken(env, 'nope')).toBeNull();
  });
});

describe('POST /api/auth/request', () => {
  it('returns uniform 200 for any email and stores a token', async () => {
    const res = await SELF.fetch('http://x/api/auth/request', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:8787' },
      body: JSON.stringify({ email: 'c@d.com' }),
    });
    expect(res.status).toBe(200);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM magic_tokens').first<{ n: number }>();
    expect(n!.n).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `npm test -- auth` → Expected: FAIL (module not found).

- [ ] **Step 3: Implement `tokens.ts`, `mailer.ts`, `routes.ts`, mount in `index.ts`**

```typescript
// src/worker/auth/tokens.ts
import type { Env } from '../types';
import { randomToken, sha256Hex } from './crypto';

const TTL_MS = 10 * 60 * 1000;

export async function issueToken(env: Env, email: string): Promise<string> {
  const raw = randomToken();
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO magic_tokens (token_hash, email, expires_at, consumed_at, created_at) VALUES (?,?,?,NULL,?)'
  ).bind(await sha256Hex(raw), email.toLowerCase(), now + TTL_MS, now).run();
  return raw;
}

// Atomic single-use consume: marks consumed only if unconsumed AND unexpired.
export async function consumeToken(env: Env, raw: string): Promise<string | null> {
  const hash = await sha256Hex(raw);
  const now = Date.now();
  const res = await env.DB.prepare(
    'UPDATE magic_tokens SET consumed_at=?1 WHERE token_hash=?2 AND consumed_at IS NULL AND expires_at > ?1'
  ).bind(now, hash).run();
  if ((res.meta.changes ?? 0) !== 1) return null;
  const row = await env.DB.prepare('SELECT email FROM magic_tokens WHERE token_hash=?').bind(hash).first<{ email: string }>();
  return row?.email ?? null;
}
```

```typescript
// src/worker/auth/mailer.ts
import type { Env } from '../types';

export async function sendMagicLink(env: Env, email: string, url: string): Promise<void> {
  if (env.AUTH_TEST_MODE === '1') return; // tests read the token from D1 instead
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: 'open-retro <login@YOUR_VERIFIED_DOMAIN>', // replace with a Resend-verified domain
      to: email, subject: 'Your open-retro login link',
      html: `<p>Click to sign in:</p><p><a href="${url}">${url}</a></p><p>Expires in 10 minutes.</p>`,
    }),
  });
  if (!res.ok) throw new Error(`Resend failed: ${res.status}`);
}
```

```typescript
// src/worker/auth/routes.ts
import { Hono } from 'hono';
import type { Env } from '../types';
import { issueToken } from './tokens';
import { sendMagicLink } from './mailer';

export const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.post('/request', async (c) => {
  const { email } = await c.req.json<{ email?: string }>().catch(() => ({ email: undefined }));
  if (email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    const raw = await issueToken(c.env, email);
    const url = `${c.env.APP_ORIGIN}/api/auth/verify?token=${encodeURIComponent(raw)}`;
    try { await sendMagicLink(c.env, email, url); } catch { /* do not leak */ }
    if (c.env.AUTH_TEST_MODE === '1') return c.json({ ok: true, devUrl: url });
  }
  return c.json({ ok: true }); // uniform response — no enumeration
});
```

Mount in `src/worker/index.ts`:
```typescript
import { authRoutes } from './auth/routes';
app.route('/api/auth', authRoutes);
```

- [ ] **Step 4: Run to verify pass** — Run: `npm test -- auth` → Expected: PASS (token + request tests).

- [ ] **Step 5: Commit**

```bash
git add src/worker/auth test/worker/auth.test.ts src/worker/index.ts && git commit -m "feat: magic-token issue/consume and POST /api/auth/request"
```

---

## Task 6: Sessions, verify route, logout, middleware

**Files:**
- Create: `src/worker/auth/sessions.ts`, `src/worker/auth/middleware.ts`
- Modify: `src/worker/auth/routes.ts` (verify, logout), `src/worker/index.ts`
- Test: `test/worker/auth.test.ts` (append)

**Interfaces:**
- Consumes: `consumeToken` (Task 5), `randomToken`/`sha256Hex` (Task 4).
- Produces: `createSession(env, userId): Promise<string>` (raw id), `userIdForSession(env, raw): Promise<string | null>`, `deleteSession(env, raw)`, cookie helpers `setSessionCookie(c, raw)`/`clearSessionCookie(c)`; `requireSession` + `requireOrigin` Hono middleware. Routes `GET /api/auth/verify`, `POST /api/auth/logout`.

- [ ] **Step 1: Write the failing tests (append to `test/worker/auth.test.ts`)**

```typescript
import { upsertUserByEmail } from '../../src/worker/auth/sessions'; // helper added below

describe('verify + session', () => {
  it('verify consumes token, sets cookie, redirects to /', async () => {
    const raw = await issueToken(env, 'e@f.com');
    const res = await SELF.fetch(`http://localhost:8787/api/auth/verify?token=${encodeURIComponent(raw)}`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
    expect(res.headers.get('set-cookie')).toMatch(/session=/);
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly/i);
  });

  it('rejects a request to a protected route without a session', async () => {
    const res = await SELF.fetch('http://localhost:8787/api/boards', { headers: { origin: 'http://localhost:8787' } });
    expect(res.status).toBe(401);
  });

  it('rejects mutating request from a foreign origin', async () => {
    const res = await SELF.fetch('http://localhost:8787/api/auth/logout', {
      method: 'POST', headers: { origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
  });
});
```

> `/api/boards` (Task 7) does not exist yet; this 401 test passes once `requireSession` guards the `/api` group. Keep the test; it asserts middleware behavior, and Task 7 adds the route under the same guard.

- [ ] **Step 2: Run to verify it fails** — Run: `npm test -- auth` → Expected: FAIL.

- [ ] **Step 3: Implement sessions, middleware, verify/logout routes**

```typescript
// src/worker/auth/sessions.ts
import type { Context } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import type { Env } from '../types';
import { randomToken, sha256Hex } from './crypto';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function upsertUserByEmail(env: Env, email: string): Promise<string> {
  const e = email.toLowerCase();
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(e).first<{ id: string }>();
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO users (id,email,display_name,created_at) VALUES (?,?,?,?)')
    .bind(id, e, e.split('@')[0], Date.now()).run();
  return id;
}

export async function createSession(env: Env, userId: string): Promise<string> {
  const raw = randomToken();
  const now = Date.now();
  await env.DB.prepare('INSERT INTO sessions (id_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)')
    .bind(await sha256Hex(raw), userId, now + SESSION_TTL_MS, now).run();
  return raw;
}

export async function userIdForSession(env: Env, raw: string | undefined): Promise<string | null> {
  if (!raw) return null;
  const row = await env.DB.prepare('SELECT user_id, expires_at FROM sessions WHERE id_hash=?')
    .bind(await sha256Hex(raw)).first<{ user_id: string; expires_at: number }>();
  if (!row || row.expires_at < Date.now()) return null;
  return row.user_id;
}

export async function deleteSession(env: Env, raw: string | undefined): Promise<void> {
  if (!raw) return;
  await env.DB.prepare('DELETE FROM sessions WHERE id_hash=?').bind(await sha256Hex(raw)).run();
}

export function setSessionCookie(c: Context<{ Bindings: Env }>, raw: string) {
  setCookie(c, 'session', raw, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: SESSION_TTL_MS / 1000 });
}
export function clearSessionCookie(c: Context<{ Bindings: Env }>) {
  deleteCookie(c, 'session', { path: '/' });
}
```

```typescript
// src/worker/auth/middleware.ts
import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import type { Env } from '../types';
import { userIdForSession } from './sessions';

// Sets c.var.userId or 401. Use on protected /api groups.
export const requireSession = createMiddleware<{ Bindings: Env; Variables: { userId: string } }>(async (c, next) => {
  const userId = await userIdForSession(c.env, getCookie(c, 'session'));
  if (!userId) return c.json({ error: 'unauthorized' }, 401);
  c.set('userId', userId);
  await next();
});

// Rejects mutating cross-origin requests (CSRF/CSWSH defense-in-depth).
export const requireOrigin = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const origin = c.req.header('origin');
  if (origin && origin !== c.env.APP_ORIGIN) return c.json({ error: 'forbidden_origin' }, 403);
  await next();
});
```

Append to `src/worker/auth/routes.ts`:
```typescript
import { consumeToken } from './tokens';
import { upsertUserByEmail, createSession, deleteSession, setSessionCookie, clearSessionCookie } from './sessions';
import { getCookie } from 'hono/cookie';

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
```

In `src/worker/index.ts`, apply origin guard to all mutating `/api` and session guard to `/api/boards` (added Task 7). For now:
```typescript
import { requireOrigin } from './auth/middleware';
app.use('/api/*', async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return requireOrigin(c, next);
  await next();
});
```

- [ ] **Step 4: Run to verify pass** — Run: `npm test -- auth` → Expected: PASS (verify/origin tests; the 401 test goes green after Task 7 mounts `/api/boards` under `requireSession` — until then it returns 404, so temporarily assert `!== 200` or add a stub `app.get('/api/boards', requireSession, ...)` now).

> To keep this task green immediately, add a stub now: `app.get('/api/boards', requireSession, (c) => c.json([]))` and expand it in Task 7.

- [ ] **Step 5: Commit**

```bash
git add src/worker/auth test/worker/auth.test.ts src/worker/index.ts && git commit -m "feat: sessions, magic-link verify, logout, session+origin middleware"
```

---

## Task 7: Boards repo + CRUD routes

**Files:**
- Create: `src/worker/boards/repo.ts`, `src/worker/boards/routes.ts`
- Modify: `src/worker/index.ts`
- Test: `test/worker/boards.test.ts`

**Interfaces:**
- Consumes: `requireSession` (Task 6), `Env`, `TEMPLATES`/`LIMITS` (Task 2).
- Produces: repo fns `createBoard`, `listBoardsForUser`, `getBoard`, `isMember`, `addMember`, `countBoardsOwnedBy`; routes `GET /api/boards`, `POST /api/boards`, `GET /api/boards/:id`.
- Board JSON shape returned to client: `{ id, name, template, maxVotes, ownerId, createdAt, role }`.

- [ ] **Step 1: Write the failing tests**

```typescript
// test/worker/boards.test.ts
import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { issueToken } from '../../src/worker/auth/tokens';

async function login(email: string): Promise<string> {
  const raw = await issueToken(env, email);
  const res = await SELF.fetch(`http://localhost:8787/api/auth/verify?token=${encodeURIComponent(raw)}`, { redirect: 'manual' });
  return res.headers.get('set-cookie')!.split(';')[0]; // "session=..."
}

beforeEach(async () => {
  for (const t of ['boards', 'board_members', 'sessions', 'users', 'magic_tokens'])
    await env.DB.exec(`DELETE FROM ${t}`);
});

describe('boards CRUD', () => {
  it('creates a board, lists it, owner is a member', async () => {
    const cookie = await login('o@x.com');
    const create = await SELF.fetch('http://localhost:8787/api/boards', {
      method: 'POST', headers: { cookie, origin: 'http://localhost:8787', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Sprint 12', template: 'sailboat', maxVotes: 6 }),
    });
    expect(create.status).toBe(200);
    const board = await create.json<{ id: string; role: string }>();
    expect(board.role).toBe('owner');

    const list = await SELF.fetch('http://localhost:8787/api/boards', { headers: { cookie, origin: 'http://localhost:8787' } });
    expect((await list.json<any[]>()).map(b => b.id)).toContain(board.id);
  });

  it('rejects invalid template / max_votes', async () => {
    const cookie = await login('o@x.com');
    const res = await SELF.fetch('http://localhost:8787/api/boards', {
      method: 'POST', headers: { cookie, origin: 'http://localhost:8787', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x', template: 'nope', maxVotes: 999 }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `npm test -- boards` → Expected: FAIL.

- [ ] **Step 3: Implement repo + routes**

```typescript
// src/worker/boards/repo.ts
import type { Env } from '../types';
import type { TemplateId } from '../../shared/protocol';

export interface BoardRow { id: string; name: string; owner_id: string; template: TemplateId; max_votes: number; created_at: number; }

export async function createBoard(env: Env, ownerId: string, name: string, template: TemplateId, maxVotes: number): Promise<BoardRow> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO boards (id,name,owner_id,template,max_votes,created_at) VALUES (?,?,?,?,?,?)')
      .bind(id, name, ownerId, template, maxVotes, now),
    env.DB.prepare('INSERT INTO board_members (board_id,user_id,role,joined_at) VALUES (?,?,?,?)')
      .bind(id, ownerId, 'owner', now),
  ]);
  return { id, name, owner_id: ownerId, template, max_votes: maxVotes, created_at: now };
}

export async function listBoardsForUser(env: Env, userId: string) {
  const { results } = await env.DB.prepare(
    `SELECT b.*, m.role FROM boards b JOIN board_members m ON m.board_id=b.id
     WHERE m.user_id=? ORDER BY b.created_at DESC`).bind(userId).all<BoardRow & { role: string }>();
  return results;
}

export async function getBoard(env: Env, id: string): Promise<BoardRow | null> {
  return env.DB.prepare('SELECT * FROM boards WHERE id=?').bind(id).first<BoardRow>();
}

export async function isMember(env: Env, boardId: string, userId: string): Promise<boolean> {
  const r = await env.DB.prepare('SELECT 1 FROM board_members WHERE board_id=? AND user_id=?').bind(boardId, userId).first();
  return !!r;
}

export async function addMember(env: Env, boardId: string, userId: string): Promise<void> {
  await env.DB.prepare('INSERT OR IGNORE INTO board_members (board_id,user_id,role,joined_at) VALUES (?,?,?,?)')
    .bind(boardId, userId, 'member', Date.now()).run();
}

export async function countBoardsOwnedBy(env: Env, userId: string): Promise<number> {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM boards WHERE owner_id=?').bind(userId).first<{ n: number }>();
  return r?.n ?? 0;
}
```

```typescript
// src/worker/boards/routes.ts
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSession } from '../auth/middleware';
import { TEMPLATES, LIMITS, type TemplateId } from '../../shared/protocol';
import * as repo from './repo';

type Vars = { Variables: { userId: string }; Bindings: Env };
export const boardRoutes = new Hono<Vars>();
boardRoutes.use('*', requireSession);

const toJson = (b: repo.BoardRow & { role?: string }) =>
  ({ id: b.id, name: b.name, template: b.template, maxVotes: b.max_votes, ownerId: b.owner_id, createdAt: b.created_at, role: b.role });

boardRoutes.get('/', async (c) => c.json((await repo.listBoardsForUser(c.env, c.get('userId'))).map(toJson)));

boardRoutes.post('/', async (c) => {
  const body = await c.req.json<{ name?: string; template?: string; maxVotes?: number }>().catch(() => ({}));
  const name = (body.name ?? '').trim();
  const template = body.template as TemplateId;
  const maxVotes = Number(body.maxVotes);
  if (!name || name.length > LIMITS.boardName) return c.json({ error: 'bad_name' }, 400);
  if (!(template in TEMPLATES)) return c.json({ error: 'bad_template' }, 400);
  if (!Number.isInteger(maxVotes) || maxVotes < 1 || maxVotes > LIMITS.maxVotesMax) return c.json({ error: 'bad_max_votes' }, 400);
  if (await repo.countBoardsOwnedBy(c.env, c.get('userId')) >= LIMITS.boardsPerUser) return c.json({ error: 'too_many' }, 400);
  const row = await repo.createBoard(c.env, c.get('userId'), name, template, maxVotes);
  return c.json(toJson({ ...row, role: 'owner' }));
});

boardRoutes.get('/:id', async (c) => {
  const board = await repo.getBoard(c.env, c.req.param('id'));
  if (!board || !(await repo.isMember(c.env, board.id, c.get('userId')))) return c.json({ error: 'not_found' }, 404);
  return c.json(toJson(board));
});
```

In `src/worker/index.ts` replace the Task 6 stub:
```typescript
import { boardRoutes } from './boards/routes';
app.route('/api/boards', boardRoutes);
```

- [ ] **Step 4: Run to verify pass** — Run: `npm test -- boards` and `npm test -- auth` → Expected: PASS (including the Task 6 401 test now that `/api/boards` is guarded).

- [ ] **Step 5: Commit**

```bash
git add src/worker/boards test/worker/boards.test.ts src/worker/index.ts && git commit -m "feat: board CRUD routes + D1 repo with validation"
```

---

## Task 8: Join route (link-shareable membership)

**Files:**
- Modify: `src/worker/boards/routes.ts`
- Test: `test/worker/boards.test.ts` (append)

**Interfaces:**
- Consumes: `repo.getBoard`, `repo.addMember`, `repo.isMember`.
- Produces: `POST /api/boards/:id/join` → 200 `{ joined: true }`; 404 if board missing.

- [ ] **Step 1: Write the failing test**

```typescript
describe('join', () => {
  it('lets a second logged-in user join via the link and then see the board', async () => {
    const owner = await login('o2@x.com');
    const created = await (await SELF.fetch('http://localhost:8787/api/boards', {
      method: 'POST', headers: { cookie: owner, origin: 'http://localhost:8787', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'B', template: 'three_little_pigs', maxVotes: 3 }),
    })).json<{ id: string }>();

    const guest = await login('g@x.com');
    const before = await SELF.fetch(`http://localhost:8787/api/boards/${created.id}`, { headers: { cookie: guest, origin: 'http://localhost:8787' } });
    expect(before.status).toBe(404); // not a member yet

    const join = await SELF.fetch(`http://localhost:8787/api/boards/${created.id}/join`, {
      method: 'POST', headers: { cookie: guest, origin: 'http://localhost:8787' } });
    expect(join.status).toBe(200);

    const after = await SELF.fetch(`http://localhost:8787/api/boards/${created.id}`, { headers: { cookie: guest, origin: 'http://localhost:8787' } });
    expect(after.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `npm test -- boards` → Expected: FAIL (404 on join).

- [ ] **Step 3: Implement the join route (append to `boards/routes.ts`)**

```typescript
boardRoutes.post('/:id/join', async (c) => {
  const board = await repo.getBoard(c.env, c.req.param('id'));
  if (!board) return c.json({ error: 'not_found' }, 404);
  await repo.addMember(c.env, board.id, c.get('userId')); // INSERT OR IGNORE — idempotent
  return c.json({ joined: true });
});
```

- [ ] **Step 4: Run to verify pass** — Run: `npm test -- boards` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/worker/boards/routes.ts test/worker/boards.test.ts && git commit -m "feat: POST /api/boards/:id/join (link-shareable membership)"
```

---

## Task 9: BoardDb — seed & snapshot

**Files:**
- Create: `src/worker/boardroom/boarddb.ts`
- Test: `test/worker/boardroom.handlers.test.ts`

**Interfaces:**
- Consumes: `TEMPLATES`, protocol types.
- Produces: class `BoardDb` wrapping a `SqlStorage`:
  - `constructor(sql: SqlStorage)`
  - `seed(template: TemplateId, maxVotes: number, ownerId: string): void` — idempotent, synchronous
  - `getMeta(): { template: TemplateId; maxVotes: number; ownerId: string }`
  - `snapshot(userId: string): BoardSnapshot`
  - `setMaxVotes(n: number): void`

This task introduces the DO-test harness using `runInDurableObject`. Because the `BoardRoom` DO class isn't built until Task 13, tests here construct `BoardDb` over an **in-test** SQLite by spinning a throwaway DO. To keep Tasks 9–12 testable in isolation, expose a tiny test-only DO that hands back its `BoardDb`.

- [ ] **Step 1: Add a minimal testable DO shell now (`src/worker/boardroom/boardroom.ts`)**

```typescript
import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types';
import { BoardDb } from './boarddb';

export class BoardRoom extends DurableObject<Env> {
  db: BoardDb;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = new BoardDb(ctx.storage.sql);
  }
  // test seam: lets vitest drive the db directly via runInDurableObject
  _db(): BoardDb { return this.db; }
}
```

Register in `wrangler.jsonc` already done (Task 1). Add `export { BoardRoom } from './boardroom/boardroom';` to `src/worker/index.ts`.

- [ ] **Step 2: Write the failing test**

```typescript
// test/worker/boardroom.handlers.test.ts
import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

function freshStub() {
  const id = env.BOARDROOM.newUniqueId();
  return env.BOARDROOM.get(id);
}

describe('BoardDb seed + snapshot', () => {
  it('seeds template columns idempotently and returns meta', async () => {
    const stub = freshStub();
    const snap = await runInDurableObject(stub, (instance: any) => {
      instance.db.seed('sailboat', 6, 'owner-1');
      instance.db.seed('sailboat', 6, 'owner-1'); // second call must not double-seed
      return instance.db.snapshot('owner-1');
    });
    expect(snap.meta).toEqual({ template: 'sailboat', maxVotes: 6, ownerId: 'owner-1' });
    expect(snap.columns.map((c: any) => c.id)).toEqual(['wind', 'anchors', 'rocks', 'island']);
    expect(snap.cards).toEqual([]);
    expect(snap.yourVotes).toEqual({});
  });
});
```

- [ ] **Step 3: Run to verify it fails** — Run: `npm test -- boardroom.handlers` → Expected: FAIL (`BoardDb` not implemented).

- [ ] **Step 4: Implement `boarddb.ts` (seed + snapshot + meta)**

```typescript
// src/worker/boardroom/boarddb.ts
import { TEMPLATES } from '../../shared/templates';
import type { BoardSnapshot, Card, ColumnDef, TemplateId } from '../../shared/protocol';

export class BoardDb {
  constructor(private sql: SqlStorage) { this.init(); }

  private init(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY CHECK (id=1), template TEXT, max_votes INTEGER, owner_id TEXT, seeded INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS columns (id TEXT PRIMARY KEY, title TEXT, subtitle TEXT, position INTEGER);
      CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY, column_id TEXT, text TEXT, author_id TEXT, author_name TEXT, position REAL, created_at INTEGER);
      CREATE TABLE IF NOT EXISTS votes (card_id TEXT, user_id TEXT, count INTEGER, PRIMARY KEY (card_id, user_id));
    `);
  }

  seed(template: TemplateId, maxVotes: number, ownerId: string): void {
    const row = this.sql.exec('SELECT seeded FROM meta WHERE id=1').toArray()[0] as { seeded: number } | undefined;
    if (row?.seeded === 1) return;
    this.sql.exec('INSERT OR REPLACE INTO meta (id,template,max_votes,owner_id,seeded) VALUES (1,?,?,?,1)', template, maxVotes, ownerId);
    TEMPLATES[template].columns.forEach((col: ColumnDef, i: number) => {
      this.sql.exec('INSERT OR IGNORE INTO columns (id,title,subtitle,position) VALUES (?,?,?,?)', col.id, col.title, col.subtitle, i);
    });
  }

  getMeta(): { template: TemplateId; maxVotes: number; ownerId: string } {
    const m = this.sql.exec('SELECT template,max_votes,owner_id FROM meta WHERE id=1').one() as any;
    return { template: m.template, maxVotes: m.max_votes, ownerId: m.owner_id };
  }

  setMaxVotes(n: number): void { this.sql.exec('UPDATE meta SET max_votes=? WHERE id=1', n); }

  snapshot(userId: string): BoardSnapshot {
    const meta = this.getMeta();
    const columns = this.sql.exec('SELECT id,title,subtitle FROM columns ORDER BY position').toArray() as unknown as ColumnDef[];
    const cards = (this.sql.exec(
      `SELECT c.id,c.column_id,c.text,c.author_id,c.author_name,c.position,c.created_at,
              COALESCE((SELECT SUM(count) FROM votes v WHERE v.card_id=c.id),0) AS votes
       FROM cards c ORDER BY c.position, c.created_at, c.id`).toArray() as any[])
      .map((r): Card => ({ id: r.id, columnId: r.column_id, text: r.text, authorId: r.author_id, authorName: r.author_name, position: r.position, createdAt: r.created_at, votes: Number(r.votes) }));
    const yourVotes: Record<string, number> = {};
    for (const r of this.sql.exec('SELECT card_id,count FROM votes WHERE user_id=?', userId).toArray() as any[]) yourVotes[r.card_id] = r.count;
    return { meta, columns, cards, yourVotes };
  }
}
```

- [ ] **Step 5: Run to verify pass + commit** — Run: `npm test -- boardroom.handlers` → Expected: PASS.

```bash
git add src/worker/boardroom test/worker/boardroom.handlers.test.ts src/worker/index.ts && git commit -m "feat: BoardDb seed + snapshot; testable BoardRoom shell"
```

---

## Task 10: BoardDb + handlers — add/edit/delete card

**Files:**
- Modify: `src/worker/boardroom/boarddb.ts`
- Create: `src/worker/boardroom/handlers.ts`
- Test: `test/worker/boardroom.handlers.test.ts` (append)

**Interfaces:**
- Produces on `BoardDb`: `addCard(card: {id,columnId,text,authorId,authorName}): Card` (assigns position = max+1024, created_at=now), `getCard(id): Card | null`, `editCard(id,text): boolean`, `deleteCard(id): void` (deletes votes then card).
- Produces `handlers.ts`: pure functions `(db, actor, payload) => ActionResult`:
  - `handleAddCard(db, actor, p: {clientCardId,columnId,text})`
  - `handleEditCard(db, actor, p: {cardId,text})`
  - `handleDeleteCard(db, actor, p: {cardId})`
  Author/owner authz enforced here. Text length validated against `LIMITS.cardText`.

- [ ] **Step 1: Write the failing tests (append)**

```typescript
import { handleAddCard, handleEditCard, handleDeleteCard } from '../../src/worker/boardroom/handlers';
const ACTOR = { userId: 'u1', displayName: 'Ann' };

it('add_card inserts and echoes clientCardId', async () => {
  const stub = freshStub();
  const res = await runInDurableObject(stub, (i: any) => {
    i.db.seed('three_little_pigs', 3, 'u1');
    return handleAddCard(i.db, ACTOR, { clientCardId: 'cc1', columnId: 'straws', text: 'flaky tests' });
  });
  expect(res.broadcast?.[0]).toMatchObject({ type: 'card_added', clientCardId: 'cc1' });
  expect((res.broadcast?.[0] as any).card).toMatchObject({ columnId: 'straws', text: 'flaky tests', authorId: 'u1', authorName: 'Ann', votes: 0 });
});

it('edit_card by non-author is rejected', async () => {
  const stub = freshStub();
  const res = await runInDurableObject(stub, (i: any) => {
    i.db.seed('three_little_pigs', 3, 'owner');
    handleAddCard(i.db, ACTOR, { clientCardId: 'cc1', columnId: 'straws', text: 'x' });
    const card = i.db.snapshot('u1').cards[0];
    return handleEditCard(i.db, { userId: 'intruder', displayName: 'I' }, { cardId: card.id, text: 'hacked' });
  });
  expect(res.actor?.[0]).toMatchObject({ type: 'error', code: 'forbidden' });
});

it('owner can delete another user card and votes are gone', async () => {
  const stub = freshStub();
  const res = await runInDurableObject(stub, (i: any) => {
    i.db.seed('three_little_pigs', 3, 'owner');
    handleAddCard(i.db, ACTOR, { clientCardId: 'cc1', columnId: 'straws', text: 'x' });
    const card = i.db.snapshot('u1').cards[0];
    const del = handleDeleteCard(i.db, { userId: 'owner', displayName: 'O' }, { cardId: card.id });
    return { del, remaining: i.db.snapshot('u1').cards.length };
  });
  expect(res.del.broadcast?.[0]).toMatchObject({ type: 'card_deleted' });
  expect(res.remaining).toBe(0);
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `npm test -- boardroom.handlers` → Expected: FAIL.

- [ ] **Step 3: Implement BoardDb card methods + handlers**

Append to `boarddb.ts`:
```typescript
  addCard(card: { id: string; columnId: string; text: string; authorId: string; authorName: string }): Card {
    const now = Date.now();
    const max = (this.sql.exec('SELECT COALESCE(MAX(position),0) AS m FROM cards WHERE column_id=?', card.columnId).one() as any).m as number;
    const position = max + 1024;
    this.sql.exec('INSERT INTO cards (id,column_id,text,author_id,author_name,position,created_at) VALUES (?,?,?,?,?,?,?)',
      card.id, card.columnId, card.text, card.authorId, card.authorName, position, now);
    return { id: card.id, columnId: card.columnId, text: card.text, authorId: card.authorId, authorName: card.authorName, position, createdAt: now, votes: 0 };
  }
  getCard(id: string): Card | null {
    const r = this.sql.exec(`SELECT id,column_id,text,author_id,author_name,position,created_at,
      COALESCE((SELECT SUM(count) FROM votes WHERE card_id=?1),0) AS votes FROM cards WHERE id=?1`, id).toArray()[0] as any;
    return r ? { id: r.id, columnId: r.column_id, text: r.text, authorId: r.author_id, authorName: r.author_name, position: r.position, createdAt: r.created_at, votes: Number(r.votes) } : null;
  }
  columnExists(columnId: string): boolean { return !!this.sql.exec('SELECT 1 FROM columns WHERE id=?', columnId).toArray()[0]; }
  editCard(id: string, text: string): boolean { return this.sql.exec('UPDATE cards SET text=? WHERE id=?', text, id).rowsWritten > 0; }
  deleteCard(id: string): void { this.sql.exec('DELETE FROM votes WHERE card_id=?', id); this.sql.exec('DELETE FROM cards WHERE id=?', id); }
```

`handlers.ts`:
```typescript
import type { BoardDb } from './boarddb';
import type { ActionResult, Identity } from '../../shared/protocol';
import { LIMITS } from '../../shared/protocol';

const err = (code: string, msg = code): ActionResult => ({ actor: [{ type: 'error', code, msg }] });

export function handleAddCard(db: BoardDb, actor: Identity, p: { clientCardId: string; columnId: string; text: string }): ActionResult {
  const text = (p.text ?? '').trim();
  if (!text || text.length > LIMITS.cardText) return err('bad_text');
  if (!db.columnExists(p.columnId)) return err('bad_column');
  const id = /^[0-9a-f-]{8,}$/i.test(p.clientCardId) ? p.clientCardId : crypto.randomUUID();
  const card = db.addCard({ id, columnId: p.columnId, text, authorId: actor.userId, authorName: actor.displayName });
  return { broadcast: [{ type: 'card_added', card, clientCardId: p.clientCardId }] };
}

function authorOrOwner(db: BoardDb, actor: Identity, authorId: string): boolean {
  return actor.userId === authorId || actor.userId === db.getMeta().ownerId;
}

export function handleEditCard(db: BoardDb, actor: Identity, p: { cardId: string; text: string }): ActionResult {
  const card = db.getCard(p.cardId); if (!card) return err('not_found');
  if (!authorOrOwner(db, actor, card.authorId)) return err('forbidden');
  const text = (p.text ?? '').trim(); if (!text || text.length > LIMITS.cardText) return err('bad_text');
  db.editCard(p.cardId, text);
  return { broadcast: [{ type: 'card_edited', cardId: p.cardId, text }] };
}

export function handleDeleteCard(db: BoardDb, actor: Identity, p: { cardId: string }): ActionResult {
  const card = db.getCard(p.cardId); if (!card) return err('not_found');
  if (!authorOrOwner(db, actor, card.authorId)) return err('forbidden');
  db.deleteCard(p.cardId);
  return { broadcast: [{ type: 'card_deleted', cardId: p.cardId }] };
}
```

- [ ] **Step 4: Run to verify pass + commit** — Run: `npm test -- boardroom.handlers` → Expected: PASS.

```bash
git add src/worker/boardroom test/worker/boardroom.handlers.test.ts && git commit -m "feat: add/edit/delete card handlers with author-or-owner authz"
```

---

## Task 11: BoardDb + handlers — atomic vote / unvote

**Files:**
- Modify: `src/worker/boardroom/boarddb.ts`, `src/worker/boardroom/handlers.ts`
- Test: `test/worker/boardroom.handlers.test.ts` (append)

**Interfaces:**
- Produces on `BoardDb`: `voteAtomic(cardId, userId): boolean` (true if a vote was recorded, false if budget exceeded — uses max_votes from meta), `unvote(cardId, userId): void`, `voteTotal(cardId): number`, `userVoteCount(cardId, userId): number`.
- Produces handlers: `handleVote`, `handleUnvote`. On success vote: broadcast `votes_changed {cardId,total}` + actor `your_vote {cardId,yourCount}`. On budget exceeded: actor `error{budget_exceeded}`.

- [ ] **Step 1: Write the failing tests (append) — includes the budget cap and a same-tick race**

```typescript
import { handleVote, handleUnvote } from '../../src/worker/boardroom/handlers';

it('enforces the board-wide vote budget across cards', async () => {
  const stub = freshStub();
  const out = await runInDurableObject(stub, (i: any) => {
    i.db.seed('three_little_pigs', 2, 'owner'); // budget = 2
    handleAddCard(i.db, ACTOR, { clientCardId: 'c1', columnId: 'straws', text: 'a' });
    handleAddCard(i.db, ACTOR, { clientCardId: 'c2', columnId: 'straws', text: 'b' });
    const [a, b] = i.db.snapshot('u1').cards;
    const r1 = handleVote(i.db, ACTOR, { cardId: a.id });   // spend 1
    const r2 = handleVote(i.db, ACTOR, { cardId: a.id });   // spend 2 (2 on same card ok)
    const r3 = handleVote(i.db, ACTOR, { cardId: b.id });   // over budget -> reject
    return { r1, r2, r3, total: i.db.voteTotal(a.id), mine: i.db.userVoteCount(a.id, 'u1') };
  });
  expect(out.r1.broadcast?.[0]).toMatchObject({ type: 'votes_changed', total: 1 });
  expect(out.r1.actor?.[0]).toMatchObject({ type: 'your_vote', yourCount: 1 });
  expect(out.r3.actor?.[0]).toMatchObject({ type: 'error', code: 'budget_exceeded' });
  expect(out.total).toBe(2);
  expect(out.mine).toBe(2);
});

it('unvote frees budget and works regardless of cap', async () => {
  const stub = freshStub();
  const out = await runInDurableObject(stub, (i: any) => {
    i.db.seed('three_little_pigs', 1, 'owner');
    handleAddCard(i.db, ACTOR, { clientCardId: 'c1', columnId: 'straws', text: 'a' });
    const a = i.db.snapshot('u1').cards[0];
    handleVote(i.db, ACTOR, { cardId: a.id });
    const before = i.db.userVoteCount(a.id, 'u1');
    handleUnvote(i.db, ACTOR, { cardId: a.id });
    return { before, after: i.db.userVoteCount(a.id, 'u1') };
  });
  expect(out.before).toBe(1); expect(out.after).toBe(0);
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `npm test -- boardroom.handlers` → Expected: FAIL.

- [ ] **Step 3: Implement the atomic vote SQL + handlers**

Append to `boarddb.ts`. **The vote is a single conditional statement** — note the budget guard is on BOTH the insert source (`SELECT ... WHERE`) and the `ON CONFLICT DO UPDATE ... WHERE`, because an upsert's `WHERE` only gates the UPDATE branch:
```typescript
  voteAtomic(cardId: string, userId: string): boolean {
    const c = this.sql.exec(
      `INSERT INTO votes (card_id, user_id, count)
         SELECT ?1, ?2, 1
         WHERE (SELECT COALESCE(SUM(count),0) FROM votes WHERE user_id=?2) < (SELECT max_votes FROM meta WHERE id=1)
       ON CONFLICT(card_id, user_id) DO UPDATE SET count = count + 1
         WHERE (SELECT COALESCE(SUM(count),0) FROM votes WHERE user_id=?2) < (SELECT max_votes FROM meta WHERE id=1)`,
      cardId, userId);
    return c.rowsWritten > 0;
  }
  unvote(cardId: string, userId: string): void {
    this.sql.exec('UPDATE votes SET count=count-1 WHERE card_id=? AND user_id=? AND count>0', cardId, userId);
    this.sql.exec('DELETE FROM votes WHERE card_id=? AND user_id=? AND count<=0', cardId, userId);
  }
  voteTotal(cardId: string): number { return Number((this.sql.exec('SELECT COALESCE(SUM(count),0) AS t FROM votes WHERE card_id=?', cardId).one() as any).t); }
  userVoteCount(cardId: string, userId: string): number {
    const r = this.sql.exec('SELECT count FROM votes WHERE card_id=? AND user_id=?', cardId, userId).toArray()[0] as any;
    return r ? r.count : 0;
  }
```

Append to `handlers.ts`:
```typescript
export function handleVote(db: BoardDb, actor: Identity, p: { cardId: string }): ActionResult {
  if (!db.getCard(p.cardId)) return err('not_found');
  if (!db.voteAtomic(p.cardId, actor.userId)) return err('budget_exceeded');
  return {
    broadcast: [{ type: 'votes_changed', cardId: p.cardId, total: db.voteTotal(p.cardId) }],
    actor: [{ type: 'your_vote', cardId: p.cardId, yourCount: db.userVoteCount(p.cardId, actor.userId) }],
  };
}
export function handleUnvote(db: BoardDb, actor: Identity, p: { cardId: string }): ActionResult {
  if (!db.getCard(p.cardId)) return err('not_found');
  db.unvote(p.cardId, actor.userId);
  return {
    broadcast: [{ type: 'votes_changed', cardId: p.cardId, total: db.voteTotal(p.cardId) }],
    actor: [{ type: 'your_vote', cardId: p.cardId, yourCount: db.userVoteCount(p.cardId, actor.userId) }],
  };
}
```

- [ ] **Step 4: Run to verify pass + commit** — Run: `npm test -- boardroom.handlers` → Expected: PASS.

```bash
git add src/worker/boardroom test/worker/boardroom.handlers.test.ts && git commit -m "feat: atomic vote-budget enforcement (single conditional SQL) + unvote"
```

---

## Task 12: BoardDb + handlers — move card (midpoint + renormalize) & set_max_votes

**Files:**
- Modify: `src/worker/boardroom/boarddb.ts`, `src/worker/boardroom/handlers.ts`
- Test: `test/worker/boardroom.handlers.test.ts` (append)

**Interfaces:**
- Produces on `BoardDb`: `moveCard(cardId, toColumnId, beforeId, afterId): { type:'moved'; columnId:string; position:number } | { type:'reordered'; columnId:string; positions:{id:string;position:number}[] }`. Looks up CURRENT neighbor positions; renormalizes the target column (positions `1024,2048,…`) when the midpoint gap underflows; tie-break order is `position, created_at, id`.
- Produces handlers: `handleMoveCard` (returns `card_moved` or `cards_reordered`), `handleSetMaxVotes` (owner-only; updates meta + broadcasts `max_votes_changed`; returns a `d1Mirror` flag the DO uses for best-effort write-through).

- [ ] **Step 1: Write the failing tests (append)**

```typescript
import { handleMoveCard, handleSetMaxVotes } from '../../src/worker/boardroom/handlers';

it('moves a card to another column at the right position', async () => {
  const stub = freshStub();
  const out = await runInDurableObject(stub, (i: any) => {
    i.db.seed('sailboat', 6, 'owner');
    handleAddCard(i.db, ACTOR, { clientCardId: 'c1', columnId: 'wind', text: 'a' });
    const a = i.db.snapshot('u1').cards[0];
    const moved = handleMoveCard(i.db, ACTOR, { cardId: a.id, toColumnId: 'anchors', beforeId: null, afterId: null });
    return { moved, snap: i.db.snapshot('u1') };
  });
  expect(out.moved.broadcast?.[0].type).toMatch(/card_moved|cards_reordered/);
  expect(out.snap.cards[0].columnId).toBe('anchors');
});

it('set_max_votes by non-owner is rejected; owner updates + broadcasts', async () => {
  const stub = freshStub();
  const out = await runInDurableObject(stub, (i: any) => {
    i.db.seed('sailboat', 6, 'owner');
    const bad = handleSetMaxVotes(i.db, { userId: 'u1', displayName: 'A' }, { n: 3 });
    const ok = handleSetMaxVotes(i.db, { userId: 'owner', displayName: 'O' }, { n: 3 });
    return { bad, ok, meta: i.db.getMeta() };
  });
  expect(out.bad.actor?.[0]).toMatchObject({ type: 'error', code: 'forbidden' });
  expect(out.ok.broadcast?.[0]).toMatchObject({ type: 'max_votes_changed', maxVotes: 3 });
  expect(out.meta.maxVotes).toBe(3);
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `npm test -- boardroom.handlers` → Expected: FAIL.

- [ ] **Step 3: Implement move + set_max_votes**

Append to `boarddb.ts`:
```typescript
  private columnCards(columnId: string): { id: string; position: number }[] {
    return this.sql.exec('SELECT id, position FROM cards WHERE column_id=? ORDER BY position, created_at, id', columnId).toArray() as any[];
  }
  private renormalize(columnId: string): { id: string; position: number }[] {
    const cards = this.columnCards(columnId);
    const positions = cards.map((c, i) => ({ id: c.id, position: (i + 1) * 1024 }));
    for (const p of positions) this.sql.exec('UPDATE cards SET position=? WHERE id=?', p.position, p.id);
    return positions;
  }
  moveCard(cardId: string, toColumnId: string, beforeId: string | null, afterId: string | null):
    { type: 'moved'; columnId: string; position: number } | { type: 'reordered'; columnId: string; positions: { id: string; position: number }[] } {
    const pos = (id: string | null) => id ? (this.sql.exec('SELECT position FROM cards WHERE id=? AND column_id=?', id, toColumnId).toArray()[0] as any)?.position as number | undefined : undefined;
    const before = pos(beforeId);  // neighbor above (smaller position)
    const after = pos(afterId);    // neighbor below (larger position)
    let position: number;
    if (before !== undefined && after !== undefined) {
      if (after - before < 1e-9) { // underflow: renormalize then place at end as a safe default
        this.sql.exec('UPDATE cards SET column_id=? WHERE id=?', toColumnId, cardId);
        const positions = this.renormalize(toColumnId);
        return { type: 'reordered', columnId: toColumnId, positions };
      }
      position = (before + after) / 2;
    } else if (after !== undefined) position = after - 1024;
    else if (before !== undefined) position = before + 1024;
    else { const m = (this.sql.exec('SELECT COALESCE(MAX(position),0) AS m FROM cards WHERE column_id=?', toColumnId).one() as any).m as number; position = m + 1024; }
    this.sql.exec('UPDATE cards SET column_id=?, position=? WHERE id=?', toColumnId, position, cardId);
    return { type: 'moved', columnId: toColumnId, position };
  }
```

Append to `handlers.ts`:
```typescript
export function handleMoveCard(db: BoardDb, _actor: Identity, p: { cardId: string; toColumnId: string; beforeId: string | null; afterId: string | null }): ActionResult {
  if (!db.getCard(p.cardId)) return err('not_found');
  if (!db.columnExists(p.toColumnId)) return err('bad_column');
  const r = db.moveCard(p.cardId, p.toColumnId, p.beforeId, p.afterId);
  if (r.type === 'moved') return { broadcast: [{ type: 'card_moved', cardId: p.cardId, columnId: r.columnId, position: r.position }] };
  return { broadcast: [{ type: 'cards_reordered', columnId: r.columnId, positions: r.positions }] };
}

// The DO calls this; if it returns ok, the DO best-effort mirrors max_votes to D1 via ctx.waitUntil.
export function handleSetMaxVotes(db: BoardDb, actor: Identity, p: { n: number }): ActionResult & { mirrorMaxVotes?: number } {
  if (actor.userId !== db.getMeta().ownerId) return err('forbidden');
  const n = Math.trunc(p.n);
  if (!Number.isInteger(n) || n < 1 || n > LIMITS.maxVotesMax) return err('bad_max_votes');
  db.setMaxVotes(n);
  return { broadcast: [{ type: 'max_votes_changed', maxVotes: n }], mirrorMaxVotes: n };
}
```

- [ ] **Step 4: Run to verify pass + commit** — Run: `npm test -- boardroom.handlers` → Expected: PASS.

```bash
git add src/worker/boardroom test/worker/boardroom.handlers.test.ts && git commit -m "feat: move card (midpoint+renormalize) and owner-only set_max_votes"
```

---

## Task 13: BoardRoom DO — dispatch, broadcast, hibernation

**Files:**
- Modify: `src/worker/boardroom/boardroom.ts`
- Test: covered by Task 14 (WS) + the handler tests already prove logic.

**Interfaces:**
- Consumes: all handlers (Tasks 10–12), `BoardDb`.
- Produces: `BoardRoom` with `fetch(request)` (WS upgrade), `webSocketMessage(ws, raw)`, `webSocketClose(ws)`, private `dispatch(actor, msg): ActionResult`, `broadcast(msgs)`, `sendTo(ws, msgs)`. Upgrade reads `x-user-id`, `x-display-name`, `x-template`, `x-max-votes`, `x-owner-id` headers (set by the Worker, Task 14), seeds on first connect, attaches identity, sends `init`.

- [ ] **Step 1: Implement the DO (no separate unit test; behavior verified in Task 14)**

```typescript
import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types';
import { BoardDb } from './boarddb';
import * as h from './handlers';
import type { ClientMessage, ServerMessage, Identity, ActionResult } from '../../shared/protocol';
import type { TemplateId } from '../../shared/protocol';

interface Attachment { userId: string; displayName: string; }

export class BoardRoom extends DurableObject<Env> {
  db: BoardDb;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = new BoardDb(ctx.storage.sql);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const userId = request.headers.get('x-user-id')!;
    const displayName = request.headers.get('x-display-name') || 'Someone';
    // Seed synchronously on first connect from Worker-provided metadata (no D1 read here).
    this.db.seed(request.headers.get('x-template') as TemplateId, Number(request.headers.get('x-max-votes')), request.headers.get('x-owner-id')!);

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId, displayName } satisfies Attachment);
    // init snapshot synchronously, before any await — socket already registered for future broadcasts
    server.send(JSON.stringify({ type: 'init', snapshot: this.db.snapshot(userId) } satisfies ServerMessage));
    return new Response(null, { status: 101, webSocket: client });
  }

  private identity(ws: WebSocket): Identity { const a = ws.deserializeAttachment() as Attachment; return { userId: a.userId, displayName: a.displayName }; }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    let msg: ClientMessage;
    try { msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)); } catch { return; }
    const actor = this.identity(ws);
    const result = this.dispatch(actor, msg);            // synchronous critical section (no await inside)
    if (result.actor) this.sendTo(ws, result.actor);
    if (result.broadcast) this.broadcast(result.broadcast);
    const mirror = (result as any).mirrorMaxVotes as number | undefined;
    if (mirror !== undefined) this.ctx.waitUntil(this.mirrorMaxVotes(mirror)); // best-effort, after critical section
  }

  // No-await synchronous dispatch. Every branch returns before any I/O await.
  private dispatch(actor: Identity, msg: ClientMessage): ActionResult {
    switch (msg.type) {
      case 'add_card': return h.handleAddCard(this.db, actor, msg);
      case 'edit_card': return h.handleEditCard(this.db, actor, msg);
      case 'delete_card': return h.handleDeleteCard(this.db, actor, msg);
      case 'move_card': return h.handleMoveCard(this.db, actor, msg);
      case 'vote': return h.handleVote(this.db, actor, msg);
      case 'unvote': return h.handleUnvote(this.db, actor, msg);
      case 'set_max_votes': return h.handleSetMaxVotes(this.db, actor, msg);
      default: return { actor: [{ type: 'error', code: 'unknown_action', msg: 'unknown' }] };
    }
  }

  private sendTo(ws: WebSocket, msgs: ServerMessage[]) { for (const m of msgs) ws.send(JSON.stringify(m)); }
  private broadcast(msgs: ServerMessage[]) {
    const payloads = msgs.map((m) => JSON.stringify(m));
    for (const sock of this.ctx.getWebSockets()) for (const p of payloads) sock.send(p);
  }
  private async mirrorMaxVotes(n: number) {
    const board = await this.ctx.storage.get<string>('boardId'); // set on first fetch (see below) OR pass via header
    // best-effort; failure is acceptable (D1 is a denormalized mirror)
    if (board) await this.env.DB.prepare('UPDATE boards SET max_votes=? WHERE id=?').bind(n, board).run().catch(() => {});
  }
}
```

> The DO needs the `boardId` to mirror max_votes. Simplest: the Worker also sends `x-board-id` on the upgrade; in `fetch`, `await this.ctx.storage.put('boardId', headerValue)` once (this is a storage await, outside any action critical section, so it's safe). Add that line in Task 14 wiring.

- [ ] **Step 2: typecheck + commit** — Run: `npx tsc -b` → Expected: no errors.

```bash
git add src/worker/boardroom/boardroom.ts && git commit -m "feat: BoardRoom DO dispatch, hibernatable WS accept, broadcast, init snapshot"
```

---

## Task 14: WS upgrade routing (Worker → DO) + WS transport test

**Files:**
- Create: `src/worker/ws.ts`, `test/worker/boardroom.ws.test.ts`
- Modify: `src/worker/index.ts`, `src/worker/boardroom/boardroom.ts` (store boardId)

**Interfaces:**
- Consumes: `getBoard`, `isMember` (Task 7), session middleware logic (Task 6), DO namespace.
- Produces: `GET /api/boards/:id/ws` handler that validates session + origin + membership, then forwards the upgrade to the DO with identity/meta headers. Runs in the `worker-ws` Vitest project.

- [ ] **Step 1: Write the failing WS test (runs under `test:ws`)**

```typescript
// test/worker/boardroom.ws.test.ts
import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { issueToken } from '../../src/worker/auth/tokens';

async function login(email: string): Promise<string> {
  const raw = await issueToken(env, email);
  const res = await SELF.fetch(`http://localhost:8787/api/auth/verify?token=${encodeURIComponent(raw)}`, { redirect: 'manual' });
  return res.headers.get('set-cookie')!.split(';')[0];
}
beforeEach(async () => { for (const t of ['boards','board_members','sessions','users','magic_tokens']) await env.DB.exec(`DELETE FROM ${t}`); });

describe('WS transport', () => {
  it('a member connects and receives an init snapshot; a second client sees the first client card', async () => {
    const cookie = await login('o@x.com');
    const board = await (await SELF.fetch('http://localhost:8787/api/boards', { method: 'POST',
      headers: { cookie, origin: 'http://localhost:8787', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'B', template: 'three_little_pigs', maxVotes: 3 }) })).json<{ id: string }>();

    const wsRes = await SELF.fetch(`http://localhost:8787/api/boards/${board.id}/ws`, {
      headers: { upgrade: 'websocket', cookie, origin: 'http://localhost:8787' } });
    expect(wsRes.status).toBe(101);
    const ws = wsRes.webSocket!; ws.accept();
    const init = await new Promise<any>((res) => ws.addEventListener('message', (e) => res(JSON.parse(e.data as string)), { once: true }));
    expect(init.type).toBe('init');
    expect(init.snapshot.columns).toHaveLength(3);
  });

  it('rejects a non-member upgrade with 403', async () => {
    const owner = await login('o@x.com');
    const board = await (await SELF.fetch('http://localhost:8787/api/boards', { method: 'POST',
      headers: { cookie: owner, origin: 'http://localhost:8787', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'B', template: 'sailboat', maxVotes: 3 }) })).json<{ id: string }>();
    const guest = await login('g@x.com');
    const res = await SELF.fetch(`http://localhost:8787/api/boards/${board.id}/ws`, {
      headers: { upgrade: 'websocket', cookie: guest, origin: 'http://localhost:8787' } });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `npm run test:ws` → Expected: FAIL.

- [ ] **Step 3: Implement `ws.ts` and wire it**

```typescript
// src/worker/ws.ts
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Env } from './types';
import { userIdForSession } from './auth/sessions';
import { getBoard, isMember } from './boards/repo';

export async function handleWsUpgrade(c: Context<{ Bindings: Env }>): Promise<Response> {
  if (c.req.header('upgrade') !== 'websocket') return c.text('expected websocket', 426);
  const origin = c.req.header('origin');
  if (origin && origin !== c.env.APP_ORIGIN) return c.text('forbidden_origin', 403);

  const userId = await userIdForSession(c.env, getCookie(c, 'session'));
  if (!userId) return c.text('unauthorized', 401);

  const boardId = c.req.param('id');
  const board = await getBoard(c.env, boardId);
  if (!board) return c.text('not_found', 404);
  if (!(await isMember(c.env, boardId, userId))) return c.text('forbidden', 403); // side-effect-free; join is a separate POST

  const user = await c.env.DB.prepare('SELECT display_name FROM users WHERE id=?').bind(userId).first<{ display_name: string }>();

  const stub = c.env.BOARDROOM.get(c.env.BOARDROOM.idFromName(boardId));
  const fwd = new Request(c.req.url, {
    headers: {
      upgrade: 'websocket',
      'x-user-id': userId,
      'x-display-name': user?.display_name ?? 'Someone',
      'x-board-id': boardId,
      'x-template': board.template,
      'x-max-votes': String(board.max_votes),
      'x-owner-id': board.owner_id,
    },
  });
  return stub.fetch(fwd);
}
```

In `src/worker/index.ts` (mount BEFORE the generic `/api/boards` group, or as a distinct route — order matters because the assets `run_worker_first` already routes `/api/*` to the worker):
```typescript
import { handleWsUpgrade } from './ws';
app.get('/api/boards/:id/ws', (c) => handleWsUpgrade(c));
```

In `boardroom.ts` `fetch`, persist boardId once (storage await is fine here — not inside an action critical section):
```typescript
if (!(await this.ctx.storage.get('boardId'))) await this.ctx.storage.put('boardId', request.headers.get('x-board-id'));
```

- [ ] **Step 4: Run to verify pass + commit** — Run: `npm run test:ws` → Expected: PASS. Also `npm test` (worker project) → Expected: still PASS.

```bash
git add src/worker/ws.ts src/worker/index.ts src/worker/boardroom/boardroom.ts test/worker/boardroom.ws.test.ts && git commit -m "feat: authenticated WS upgrade routing into BoardRoom DO + transport tests"
```

---

## Task 15: Frontend reducer (pure)

**Files:**
- Create: `src/client/board/reducer.ts`, `src/client/types.ts`
- Test: `test/client/reducer.test.ts`

**Interfaces:**
- Consumes: `ServerMessage`, `Card`, `BoardSnapshot` (protocol).
- Produces: `initialState`, `BoardState { columns, cards: Record<id,Card>, order: Record<colId,id[]>, maxVotes, ownerId, yourVotes: Record<id,number>, ready: boolean }`, `reducer(state, action)` where action is `{ kind:'server'; msg:ServerMessage } | { kind:'optimistic_add'; card:Card } | { kind:'reset' }`. Folds are **idempotent/set-based**: `card_added` upserts by id, `votes_changed` sets total, `card_deleted` deletes-if-present; patches before `init` are ignored; `init` replaces all state.

- [ ] **Step 1: Write failing tests (the highest-value frontend tests)**

```typescript
// test/client/reducer.test.ts
import { describe, it, expect } from 'vitest';
import { reducer, initialState } from '../../src/client/board/reducer';
import type { ServerMessage, BoardSnapshot } from '../../src/shared/protocol';

const snap: BoardSnapshot = {
  meta: { template: 'three_little_pigs', maxVotes: 3, ownerId: 'o' },
  columns: [{ id: 'straws', title: 'S', subtitle: '' }], cards: [], yourVotes: {},
};
const srv = (msg: ServerMessage) => ({ kind: 'server', msg } as const);

it('ignores patches before init', () => {
  const s = reducer(initialState, srv({ type: 'votes_changed', cardId: 'x', total: 5 }));
  expect(s.ready).toBe(false);
});

it('init makes ready and loads columns', () => {
  const s = reducer(initialState, srv({ type: 'init', snapshot: snap }));
  expect(s.ready).toBe(true);
  expect(s.order.straws).toEqual([]);
});

it('optimistic add then card_added with same id dedupes (no double render)', () => {
  let s = reducer(initialState, srv({ type: 'init', snapshot: snap }));
  const card = { id: 'cc1', columnId: 'straws', text: 'hi', authorId: 'me', authorName: 'Me', position: 1024, createdAt: 1, votes: 0 };
  s = reducer(s, { kind: 'optimistic_add', card });
  s = reducer(s, srv({ type: 'card_added', card, clientCardId: 'cc1' }));
  expect(s.order.straws).toEqual(['cc1']); // exactly once
});

it('votes_changed sets the total (never increments)', () => {
  let s = reducer(initialState, srv({ type: 'init', snapshot: { ...snap, cards: [{ id: 'c', columnId: 'straws', text: 't', authorId: 'a', authorName: 'A', position: 1024, createdAt: 1, votes: 0 }] } }));
  s = reducer(s, srv({ type: 'votes_changed', cardId: 'c', total: 2 }));
  s = reducer(s, srv({ type: 'votes_changed', cardId: 'c', total: 2 })); // duplicate delivery
  expect(s.cards['c'].votes).toBe(2);
});

it('reconnect init replaces state wholesale', () => {
  let s = reducer(initialState, srv({ type: 'init', snapshot: { ...snap, cards: [{ id: 'old', columnId: 'straws', text: 'x', authorId: 'a', authorName: 'A', position: 1, createdAt: 1, votes: 0 }] } }));
  s = reducer(s, srv({ type: 'init', snapshot: snap })); // fresh init, no cards
  expect(Object.keys(s.cards)).toEqual([]);
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `npm run test:client -- reducer` → Expected: FAIL.

- [ ] **Step 3: Implement `reducer.ts`**

```typescript
import type { ServerMessage, Card, BoardSnapshot, ColumnDef, TemplateId } from '../../src/shared/protocol';

export interface BoardState {
  ready: boolean;
  template: TemplateId | null;
  maxVotes: number;
  ownerId: string;
  columns: ColumnDef[];
  cards: Record<string, Card>;
  order: Record<string, string[]>;       // columnId -> cardIds (position order)
  yourVotes: Record<string, number>;
}

export const initialState: BoardState = {
  ready: false, template: null, maxVotes: 0, ownerId: '', columns: [], cards: {}, order: {}, yourVotes: {},
};

type Action = { kind: 'server'; msg: ServerMessage } | { kind: 'optimistic_add'; card: Card } | { kind: 'reset' };

function rebuildOrder(columns: ColumnDef[], cards: Record<string, Card>): Record<string, string[]> {
  const order: Record<string, string[]> = {};
  for (const c of columns) order[c.id] = [];
  for (const card of Object.values(cards)) (order[card.columnId] ??= []).push(card.id);
  for (const colId of Object.keys(order))
    order[colId].sort((a, b) => cards[a].position - cards[b].position || cards[a].createdAt - cards[b].createdAt || (cards[a].id < cards[b].id ? -1 : 1));
  return order;
}

function fromSnapshot(s: BoardSnapshot): BoardState {
  const cards: Record<string, Card> = {};
  for (const c of s.cards) cards[c.id] = c;
  return { ready: true, template: s.meta.template, maxVotes: s.meta.maxVotes, ownerId: s.meta.ownerId, columns: s.columns, cards, order: rebuildOrder(s.columns, cards), yourVotes: { ...s.yourVotes } };
}

export function reducer(state: BoardState, action: Action): BoardState {
  if (action.kind === 'reset') return initialState;
  if (action.kind === 'optimistic_add') {
    const cards = { ...state.cards, [action.card.id]: action.card };
    return { ...state, cards, order: rebuildOrder(state.columns, cards) };
  }
  const msg = action.msg;
  if (msg.type === 'init') return fromSnapshot(msg.snapshot);
  if (!state.ready) return state; // ignore patches before init

  switch (msg.type) {
    case 'card_added': {
      const cards = { ...state.cards, [msg.card.id]: msg.card }; // upsert-by-id
      return { ...state, cards, order: rebuildOrder(state.columns, cards) };
    }
    case 'card_edited': {
      const cur = state.cards[msg.cardId]; if (!cur) return state;
      return { ...state, cards: { ...state.cards, [msg.cardId]: { ...cur, text: msg.text } } };
    }
    case 'card_deleted': {
      if (!state.cards[msg.cardId]) return state;
      const cards = { ...state.cards }; delete cards[msg.cardId];
      const yourVotes = { ...state.yourVotes }; delete yourVotes[msg.cardId];
      return { ...state, cards, yourVotes, order: rebuildOrder(state.columns, cards) };
    }
    case 'card_moved': {
      const cur = state.cards[msg.cardId]; if (!cur) return state;
      const cards = { ...state.cards, [msg.cardId]: { ...cur, columnId: msg.columnId, position: msg.position } };
      return { ...state, cards, order: rebuildOrder(state.columns, cards) };
    }
    case 'cards_reordered': {
      const cards = { ...state.cards };
      for (const p of msg.positions) if (cards[p.id]) cards[p.id] = { ...cards[p.id], position: p.position };
      return { ...state, cards, order: rebuildOrder(state.columns, cards) };
    }
    case 'votes_changed': {
      const cur = state.cards[msg.cardId]; if (!cur) return state;
      return { ...state, cards: { ...state.cards, [msg.cardId]: { ...cur, votes: msg.total } } }; // set, never +=
    }
    case 'your_vote':
      return { ...state, yourVotes: { ...state.yourVotes, [msg.cardId]: msg.yourCount } };
    case 'max_votes_changed':
      return { ...state, maxVotes: msg.maxVotes };
    case 'error':
      return state; // surfaced via the hook's onError, not the reducer
    default:
      return state;
  }
}

export const spentVotes = (s: BoardState) => Object.values(s.yourVotes).reduce((a, b) => a + b, 0);
export const remainingVotes = (s: BoardState) => Math.max(0, s.maxVotes - spentVotes(s));
```

- [ ] **Step 4: Run to verify pass + commit** — Run: `npm run test:client -- reducer` → Expected: PASS (5 tests).

```bash
git add src/client/board/reducer.ts test/client/reducer.test.ts && git commit -m "feat: pure board reducer with idempotent set-based folds"
```

---

## Task 16: useBoardSocket hook

**Files:**
- Create: `src/client/board/useBoardSocket.ts`
- Test: `test/client/useBoardSocket.test.ts`

**Interfaces:**
- Consumes: `reducer`, `initialState`, protocol types.
- Produces: `useBoardSocket(boardId, opts?: { wsFactory?: (url:string)=>WebSocketLike; onError?: (m)=>void }) => { state, actions }` where `actions` = `{ addCard(columnId,text), editCard(id,text), deleteCard(id), moveCard(id,toColumnId,beforeId,afterId), vote(id), unvote(id), setMaxVotes(n) }`. `addCard` generates a `clientCardId` (crypto.randomUUID) and dispatches `optimistic_add` immediately, then sends `add_card`. Reconnect with backoff; on (re)connect the next `init` replaces state. `wsFactory` injectable for tests.

- [ ] **Step 1: Write the failing test (with a fake socket)**

```typescript
// test/client/useBoardSocket.test.ts
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useBoardSocket } from '../../src/client/board/useBoardSocket';
import type { BoardSnapshot } from '../../src/shared/protocol';

class FakeSocket {
  onopen?: () => void; onmessage?: (e: { data: string }) => void; onclose?: () => void;
  sent: string[] = [];
  constructor(public url: string) { setTimeout(() => this.onopen?.(), 0); }
  send(d: string) { this.sent.push(d); }
  close() { this.onclose?.(); }
  emit(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }); }
}

const snap: BoardSnapshot = { meta: { template: 'three_little_pigs', maxVotes: 3, ownerId: 'o' }, columns: [{ id: 'straws', title: 'S', subtitle: '' }], cards: [], yourVotes: {} };

it('connects, applies init, and optimistic add appears before server echo', async () => {
  let sock!: FakeSocket;
  const { result } = renderHook(() => useBoardSocket('b1', { wsFactory: (url) => (sock = new FakeSocket(url)) as any }));
  await act(async () => { await new Promise((r) => setTimeout(r, 1)); sock.emit({ type: 'init', snapshot: snap }); });
  await waitFor(() => expect(result.current.state.ready).toBe(true));

  act(() => result.current.actions.addCard('straws', 'hello'));
  expect(result.current.state.order.straws).toHaveLength(1);                       // optimistic
  const sent = JSON.parse(sock.sent.at(-1)!);
  expect(sent).toMatchObject({ type: 'add_card', columnId: 'straws', text: 'hello' });
  expect(sent.clientCardId).toBeTruthy();

  act(() => sock.emit({ type: 'card_added', clientCardId: sent.clientCardId, card: { id: sent.clientCardId, columnId: 'straws', text: 'hello', authorId: 'me', authorName: 'Me', position: 1024, createdAt: 1, votes: 0 } }));
  expect(result.current.state.order.straws).toHaveLength(1);                       // still one (deduped)
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `npm run test:client -- useBoardSocket` → Expected: FAIL.

- [ ] **Step 3: Implement the hook**

```typescript
import { useEffect, useMemo, useReducer, useRef } from 'react';
import { reducer, initialState } from './reducer';
import type { ClientMessage, ServerMessage } from '../../src/shared/protocol';

interface WebSocketLike { send(d: string): void; close(): void; onopen?: (() => void) | null; onclose?: (() => void) | null; onmessage?: ((e: { data: string }) => void) | null; }

export function useBoardSocket(boardId: string, opts?: { wsFactory?: (url: string) => WebSocketLike; onError?: (m: { code: string; msg: string }) => void }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const sockRef = useRef<WebSocketLike | null>(null);
  const onError = opts?.onError;

  useEffect(() => {
    let closed = false, attempt = 0, timer: ReturnType<typeof setTimeout>;
    const factory = opts?.wsFactory ?? ((url: string) => new WebSocket(url) as unknown as WebSocketLike);
    const url = `${location.origin.replace(/^http/, 'ws')}/api/boards/${boardId}/ws`;

    const connect = () => {
      const sock = factory(url); sockRef.current = sock;
      sock.onopen = () => { attempt = 0; };
      sock.onmessage = (e) => {
        const msg = JSON.parse(e.data) as ServerMessage;
        if (msg.type === 'error') onError?.({ code: msg.code, msg: msg.msg });
        dispatch({ kind: 'server', msg }); // init (incl. on reconnect) replaces state
      };
      sock.onclose = () => { if (closed) return; const delay = Math.min(1000 * 2 ** attempt++, 10000); timer = setTimeout(connect, delay); };
    };
    connect();
    return () => { closed = true; clearTimeout(timer); sockRef.current?.close(); };
  }, [boardId]);

  const send = (m: ClientMessage) => sockRef.current?.send(JSON.stringify(m));

  const actions = useMemo(() => ({
    addCard(columnId: string, text: string) {
      const clientCardId = crypto.randomUUID();
      dispatch({ kind: 'optimistic_add', card: { id: clientCardId, columnId, text, authorId: 'me', authorName: 'You', position: Number.MAX_SAFE_INTEGER, createdAt: Date.now(), votes: 0 } });
      send({ type: 'add_card', clientCardId, columnId, text });
    },
    editCard: (cardId: string, text: string) => send({ type: 'edit_card', cardId, text }),
    deleteCard: (cardId: string) => send({ type: 'delete_card', cardId }),
    moveCard: (cardId: string, toColumnId: string, beforeId: string | null, afterId: string | null) => send({ type: 'move_card', cardId, toColumnId, beforeId, afterId }),
    vote: (cardId: string) => send({ type: 'vote', cardId }),
    unvote: (cardId: string) => send({ type: 'unvote', cardId }),
    setMaxVotes: (n: number) => send({ type: 'set_max_votes', n }),
  }), [boardId]);

  return { state, actions };
}
```

- [ ] **Step 4: Run to verify pass + commit** — Run: `npm run test:client -- useBoardSocket` → Expected: PASS.

```bash
git add src/client/board/useBoardSocket.ts test/client/useBoardSocket.test.ts && git commit -m "feat: useBoardSocket hook with optimistic add and reconnect backoff"
```

---

## Task 17: Auth UI + API client + router

**Files:**
- Create: `src/client/api.ts`, `src/client/auth/useSession.ts`, `src/client/auth/LoginPage.tsx`, `src/client/App.tsx`
- Modify: `src/client/main.tsx`
- Test: `test/client/components.test.tsx` (LoginPage)

**Interfaces:**
- Produces: `api` object (`requestMagicLink(email)`, `listBoards()`, `createBoard(input)`, `getBoard(id)`, `joinBoard(id)`, `logout()`), `useSession()` → `{ user, loading }` (derives auth from a `GET /api/boards` 200/401 probe or a dedicated `/api/me`), `<App/>` routes `/login`, `/`, `/b/:id`.

- [ ] **Step 1: Add a tiny `/api/me` route to the worker (for session probe)**

In `src/worker/index.ts`:
```typescript
import { requireSession } from './auth/middleware';
app.get('/api/me', requireSession, async (c) => {
  const u = await c.env.DB.prepare('SELECT id,email,display_name FROM users WHERE id=?').bind(c.get('userId')).first();
  return c.json(u);
});
```
Add a quick worker test in `test/worker/auth.test.ts`: `/api/me` returns 401 without cookie, 200 with. (Write the test, run, confirm.)

- [ ] **Step 2: Write the failing LoginPage test**

```typescript
// test/client/components.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { LoginPage } from '../../src/client/auth/LoginPage';

it('submits email and shows the check-inbox confirmation', async () => {
  const requestMagicLink = vi.fn().mockResolvedValue(undefined);
  render(<LoginPage requestMagicLink={requestMagicLink} />);
  await userEvent.type(screen.getByLabelText(/email/i), 'a@b.com');
  await userEvent.click(screen.getByRole('button', { name: /send/i }));
  expect(requestMagicLink).toHaveBeenCalledWith('a@b.com');
  expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument();
});
```

- [ ] **Step 3: Implement `api.ts`, `LoginPage.tsx`, `useSession.ts`, `App.tsx`, `main.tsx`**

```typescript
// src/client/api.ts
const json = (r: Response) => r.ok ? r.json() : Promise.reject(new Error(String(r.status)));
const h = { 'content-type': 'application/json' };
export const api = {
  requestMagicLink: (email: string) => fetch('/api/auth/request', { method: 'POST', headers: h, body: JSON.stringify({ email }) }).then(() => {}),
  me: () => fetch('/api/me').then((r) => (r.ok ? r.json() : null)),
  listBoards: () => fetch('/api/boards').then(json),
  createBoard: (b: { name: string; template: string; maxVotes: number }) => fetch('/api/boards', { method: 'POST', headers: h, body: JSON.stringify(b) }).then(json),
  getBoard: (id: string) => fetch(`/api/boards/${id}`).then(json),
  joinBoard: (id: string) => fetch(`/api/boards/${id}/join`, { method: 'POST', headers: h }).then(json),
  logout: () => fetch('/api/auth/logout', { method: 'POST', headers: h }).then(() => {}),
};
```

```tsx
// src/client/auth/LoginPage.tsx
import { useState } from 'react';
export function LoginPage({ requestMagicLink }: { requestMagicLink: (email: string) => Promise<void> }) {
  const [email, setEmail] = useState(''); const [sent, setSent] = useState(false);
  if (sent) return <p>Check your inbox for a sign-in link.</p>;
  return (
    <form onSubmit={async (e) => { e.preventDefault(); await requestMagicLink(email); setSent(true); }}>
      <label htmlFor="email">Email</label>
      <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <button type="submit">Send magic link</button>
    </form>
  );
}
```

```typescript
// src/client/auth/useSession.ts
import { useEffect, useState } from 'react';
import { api } from '../api';
export function useSession() {
  const [user, setUser] = useState<any | null>(null); const [loading, setLoading] = useState(true);
  useEffect(() => { api.me().then(setUser).finally(() => setLoading(false)); }, []);
  return { user, loading };
}
```

```tsx
// src/client/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useSession } from './auth/useSession';
import { LoginPage } from './auth/LoginPage';
import { api } from './api';
import { BoardListPage } from './boards/BoardList';   // Task 18
import { BoardView } from './board/BoardView';         // Task 19

export function App() {
  const { user, loading } = useSession();
  if (loading) return <p>Loading…</p>;
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage requestMagicLink={api.requestMagicLink} />} />
        <Route path="/" element={user ? <BoardListPage /> : <Navigate to="/login" />} />
        <Route path="/b/:id" element={user ? <BoardView /> : <Navigate to="/login" />} />
      </Routes>
    </BrowserRouter>
  );
}
```

```tsx
// src/client/main.tsx
import { createRoot } from 'react-dom/client';
import { App } from './App';
createRoot(document.getElementById('root')!).render(<App />);
```

- [ ] **Step 4: Run to verify pass + commit** — Run: `npm run test:client -- components` and `npm test -- auth` → Expected: PASS. (BoardList/BoardView imports will fail to typecheck until Tasks 18–19; create empty stub components exporting the named symbols now to keep the build green, then flesh out.)

```bash
git add src/client src/worker/index.ts test/client/components.test.tsx test/worker/auth.test.ts && git commit -m "feat: auth UI, API client, /api/me, router"
```

---

## Task 18: Board list + create modal

**Files:**
- Create: `src/client/boards/BoardList.tsx`, `src/client/boards/BoardCard.tsx`, `src/client/boards/CreateBoardModal.tsx`
- Test: `test/client/components.test.tsx` (append)

**Interfaces:**
- Consumes: `api`, `TEMPLATES` (template picker).
- Produces: `BoardListPage` (fetches + lists boards, opens create modal, navigates to `/b/:id` on create), `CreateBoardModal({ onCreate })` with fields name / maxVotes / template (two options).

- [ ] **Step 1: Write the failing test for CreateBoardModal**

```typescript
import { CreateBoardModal } from '../../src/client/boards/CreateBoardModal';
it('creates a board with chosen template and votes', async () => {
  const onCreate = vi.fn().mockResolvedValue({ id: 'b1' });
  render(<CreateBoardModal onCreate={onCreate} onClose={() => {}} />);
  await userEvent.type(screen.getByLabelText(/name/i), 'Sprint 13');
  await userEvent.selectOptions(screen.getByLabelText(/template/i), 'sailboat');
  await userEvent.clear(screen.getByLabelText(/max votes/i));
  await userEvent.type(screen.getByLabelText(/max votes/i), '5');
  await userEvent.click(screen.getByRole('button', { name: /create/i }));
  expect(onCreate).toHaveBeenCalledWith({ name: 'Sprint 13', template: 'sailboat', maxVotes: 5 });
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `npm run test:client -- components` → Expected: FAIL.

- [ ] **Step 3: Implement the three components**

```tsx
// src/client/boards/CreateBoardModal.tsx
import { useState } from 'react';
import { TEMPLATES } from '../../src/shared/templates';
import type { TemplateId } from '../../src/shared/protocol';
export function CreateBoardModal({ onCreate, onClose }: { onCreate: (b: { name: string; template: TemplateId; maxVotes: number }) => Promise<{ id: string }>; onClose: () => void }) {
  const [name, setName] = useState(''); const [template, setTemplate] = useState<TemplateId>('three_little_pigs'); const [maxVotes, setMaxVotes] = useState(6);
  return (
    <div role="dialog" aria-label="Create board">
      <form onSubmit={async (e) => { e.preventDefault(); await onCreate({ name, template, maxVotes }); onClose(); }}>
        <label htmlFor="b-name">Name</label>
        <input id="b-name" value={name} onChange={(e) => setName(e.target.value)} required />
        <label htmlFor="b-tpl">Template</label>
        <select id="b-tpl" value={template} onChange={(e) => setTemplate(e.target.value as TemplateId)}>
          {Object.entries(TEMPLATES).map(([id, t]) => <option key={id} value={id}>{t.name}</option>)}
        </select>
        <label htmlFor="b-votes">Max votes</label>
        <input id="b-votes" type="number" min={1} max={99} value={maxVotes} onChange={(e) => setMaxVotes(Number(e.target.value))} />
        <button type="submit">Create</button>
        <button type="button" onClick={onClose}>Cancel</button>
      </form>
    </div>
  );
}
```

```tsx
// src/client/boards/BoardCard.tsx
import { Link } from 'react-router-dom';
export function BoardCard({ board }: { board: { id: string; name: string; template: string } }) {
  return <Link to={`/b/${board.id}`}><div className="board-card"><h3>{board.name}</h3><small>{board.template}</small></div></Link>;
}
```

```tsx
// src/client/boards/BoardList.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { BoardCard } from './BoardCard';
import { CreateBoardModal } from './CreateBoardModal';
export function BoardListPage() {
  const [boards, setBoards] = useState<any[]>([]); const [open, setOpen] = useState(false);
  const nav = useNavigate();
  useEffect(() => { api.listBoards().then(setBoards); }, []);
  return (
    <main>
      <header><h1>Your retros</h1><button onClick={() => setOpen(true)}>Add board</button></header>
      <div className="board-grid">{boards.map((b) => <BoardCard key={b.id} board={b} />)}</div>
      {open && <CreateBoardModal onClose={() => setOpen(false)} onCreate={async (b) => { const created = await api.createBoard(b); nav(`/b/${created.id}`); return created; }} />}
    </main>
  );
}
```

- [ ] **Step 4: Run to verify pass + commit** — Run: `npm run test:client -- components` → Expected: PASS.

```bash
git add src/client/boards test/client/components.test.tsx && git commit -m "feat: board list page and create-board modal"
```

---

## Task 19: Board view + columns/cards + drag

**Files:**
- Create: `src/client/board/BoardView.tsx`, `src/client/board/Column.tsx`, `src/client/board/Card.tsx`, `src/client/board/AddCardInput.tsx`, `src/client/board/dnd.ts`
- Test: `test/client/components.test.tsx` (append — neighbor computation is the testable unit)

**Interfaces:**
- Consumes: `useBoardSocket`, `remainingVotes`, dnd-kit.
- Produces: `BoardView` (joins board on mount via `api.joinBoard`, then renders columns from `state`), `computeNeighbors(orderedIds, fromIndex, toIndex)` → `{ beforeId, afterId }` pure helper in `dnd.ts`.

- [ ] **Step 1: Write the failing test for `computeNeighbors`**

```typescript
import { computeNeighbors } from '../../src/client/board/dnd';
it('computes neighbors for a drop position', () => {
  const ids = ['a', 'b', 'c'];
  expect(computeNeighbors(ids, 2)).toEqual({ beforeId: 'b', afterId: 'c' }); // dropping before index 2
  expect(computeNeighbors(ids, 0)).toEqual({ beforeId: null, afterId: 'a' }); // head
  expect(computeNeighbors(ids, 3)).toEqual({ beforeId: 'c', afterId: null }); // tail
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `npm run test:client -- components` → Expected: FAIL.

- [ ] **Step 3: Implement `dnd.ts`, then the view/column/card components**

```typescript
// src/client/board/dnd.ts — neighbors at the target slot in the destination column's current order (excluding the dragged card)
export function computeNeighbors(orderedIdsWithoutDragged: string[], targetIndex: number): { beforeId: string | null; afterId: string | null } {
  const before = targetIndex - 1 >= 0 ? orderedIdsWithoutDragged[targetIndex - 1] ?? null : null;
  const after = orderedIdsWithoutDragged[targetIndex] ?? null;
  return { beforeId: before, afterId: after };
}
```

```tsx
// src/client/board/Card.tsx
import type { Card as CardT } from '../../src/shared/protocol';
export function Card({ card, mine, canModify, onVote, onUnvote, onDelete }: {
  card: CardT; mine: number; canModify: boolean;
  onVote: () => void; onUnvote: () => void; onDelete: () => void;
}) {
  return (
    <div className="card">
      <p>{card.text}</p>
      <footer>
        <span>{card.authorName}</span>
        <button aria-label="downvote" onClick={onUnvote} disabled={mine === 0}>−</button>
        <span aria-label="votes">{card.votes}</span>
        <button aria-label="upvote" onClick={onVote}>+</button>
        {canModify && <button aria-label="delete" onClick={onDelete}>🗑</button>}
      </footer>
    </div>
  );
}
```

```tsx
// src/client/board/AddCardInput.tsx
import { useState } from 'react';
export function AddCardInput({ onAdd }: { onAdd: (text: string) => void }) {
  const [text, setText] = useState('');
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) { onAdd(text.trim()); setText(''); } }}>
      <input aria-label="add card" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a card…" />
    </form>
  );
}
```

```tsx
// src/client/board/Column.tsx
import { Card } from './Card';
import { AddCardInput } from './AddCardInput';
import type { BoardState } from './reducer';
export function Column({ col, state, myUserId, actions }: { col: { id: string; title: string; subtitle: string }; state: BoardState; myUserId: string; actions: any }) {
  const ids = state.order[col.id] ?? [];
  return (
    <section className="column">
      <h2>{col.title}</h2><p>{col.subtitle}</p>
      <AddCardInput onAdd={(t) => actions.addCard(col.id, t)} />
      {ids.map((id) => {
        const card = state.cards[id];
        return <Card key={id} card={card} mine={state.yourVotes[id] ?? 0}
          canModify={card.authorId === myUserId || state.ownerId === myUserId}
          onVote={() => actions.vote(id)} onUnvote={() => actions.unvote(id)} onDelete={() => actions.deleteCard(id)} />;
      })}
    </section>
  );
}
```

```tsx
// src/client/board/BoardView.tsx
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { DndContext, type DragEndEvent } from '@dnd-kit/core';
import { api } from '../api';
import { useBoardSocket } from './useBoardSocket';
import { Column } from './Column';
import { computeNeighbors } from './dnd';
import { SortToggle } from './SortToggle';        // Task 20
import { ShareButton } from './ShareButton';        // Task 20
import { MaxVotesSetting } from './MaxVotesSetting'; // Task 20

export function BoardView() {
  const { id } = useParams<{ id: string }>();
  useEffect(() => { if (id) api.joinBoard(id).catch(() => {}); }, [id]);
  const { state, actions } = useBoardSocket(id!);
  const myUserId = 'me'; // replaced by real id from /api/me via context if needed; canModify also honored server-side

  if (!state.ready) return <p>Connecting…</p>;

  const onDragEnd = (e: DragEndEvent) => {
    const cardId = String(e.active.id);
    const toColumnId = String(e.over?.data.current?.columnId ?? e.over?.id ?? '');
    if (!toColumnId) return;
    const targetIndex = Number(e.over?.data.current?.index ?? (state.order[toColumnId]?.length ?? 0));
    const without = (state.order[toColumnId] ?? []).filter((x) => x !== cardId);
    const { beforeId, afterId } = computeNeighbors(without, targetIndex);
    actions.moveCard(cardId, toColumnId, beforeId, afterId);
  };

  return (
    <main>
      <header>
        <ShareButton boardId={id!} />
        <SortToggle boardId={id!} />
        {state.ownerId === myUserId && <MaxVotesSetting value={state.maxVotes} onChange={actions.setMaxVotes} />}
      </header>
      <DndContext onDragEnd={onDragEnd}>
        <div className="columns">{state.columns.map((col) => <Column key={col.id} col={col} state={state} myUserId={myUserId} actions={actions} />)}</div>
      </DndContext>
    </main>
  );
}
```

> dnd-kit wiring (`useDraggable`/`useDroppable`, `data.current.index/columnId`) is standard library usage; the pure `computeNeighbors` is the unit under test. When sort-by-votes is active (Task 20), wrap `DndContext` so drag is disabled (Global Constraints / spec §9).

- [ ] **Step 4: Run to verify pass + commit** — Run: `npm run test:client -- components` → Expected: PASS.

```bash
git add src/client/board test/client/components.test.tsx && git commit -m "feat: board view, columns, cards, voting, drag-to-move"
```

---

## Task 20: Sort toggle, share, max-votes setting

**Files:**
- Create: `src/client/board/SortToggle.tsx`, `src/client/board/ShareButton.tsx`, `src/client/board/MaxVotesSetting.tsx`
- Modify: `src/client/board/BoardView.tsx` (apply sort to render order; disable drag while sorted)
- Test: `test/client/components.test.tsx` (append: sort ordering + drag-disabled)

**Interfaces:**
- Produces: `useSortByVotes(boardId) => [boolean, toggle]` (localStorage-backed), `sortedOrder(order, cards, sortByVotes)` pure helper, `ShareButton` (copies `location.origin + /b/:id`), `MaxVotesSetting`.

- [ ] **Step 1: Write the failing test for `sortedOrder`**

```typescript
import { sortedOrder } from '../../src/client/board/SortToggle';
it('sorts a column by votes desc when active, preserves position order when off', () => {
  const cards: any = { a: { votes: 1, position: 1 }, b: { votes: 3, position: 2 }, c: { votes: 2, position: 3 } };
  const order = { col: ['a', 'b', 'c'] };
  expect(sortedOrder(order, cards, true).col).toEqual(['b', 'c', 'a']);
  expect(sortedOrder(order, cards, false).col).toEqual(['a', 'b', 'c']);
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `npm run test:client -- components` → Expected: FAIL.

- [ ] **Step 3: Implement the three components + helper, and apply in BoardView**

```tsx
// src/client/board/SortToggle.tsx
import { useState } from 'react';
import type { Card } from '../../src/shared/protocol';
export function sortedOrder(order: Record<string, string[]>, cards: Record<string, Card>, byVotes: boolean): Record<string, string[]> {
  if (!byVotes) return order;
  const out: Record<string, string[]> = {};
  for (const [col, ids] of Object.entries(order)) out[col] = [...ids].sort((a, b) => cards[b].votes - cards[a].votes || cards[a].position - cards[b].position);
  return out;
}
export function useSortByVotes(boardId: string): [boolean, () => void] {
  const key = `sort-by-votes:${boardId}`;
  const [on, setOn] = useState(() => localStorage.getItem(key) === '1');
  return [on, () => setOn((v) => { localStorage.setItem(key, v ? '0' : '1'); return !v; })];
}
export function SortToggle({ on, toggle }: { on: boolean; toggle: () => void }) {
  return <button aria-pressed={on} onClick={toggle}>Sort by votes: {on ? 'on' : 'off'}</button>;
}
```

```tsx
// src/client/board/ShareButton.tsx
export function ShareButton({ boardId }: { boardId: string }) {
  return <button onClick={() => navigator.clipboard.writeText(`${location.origin}/b/${boardId}`)}>Share</button>;
}
```

```tsx
// src/client/board/MaxVotesSetting.tsx
export function MaxVotesSetting({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return <label>Max votes <input type="number" min={1} max={99} value={value} onChange={(e) => onChange(Number(e.target.value))} /></label>;
}
```

In `BoardView.tsx`: use `const [sortOn, toggleSort] = useSortByVotes(id!)`, render with `const view = sortedOrder(state.order, state.cards, sortOn)` (pass `view[col.id]` into `Column` via a prop, or compute inside), and **disable drag** when `sortOn` (e.g. render `DndContext` only when `!sortOn`, else a plain `<div>`). Update the `SortToggle` usage to `<SortToggle on={sortOn} toggle={toggleSort} />`.

- [ ] **Step 4: Run to verify pass + commit** — Run: `npm run test:client -- components` → Expected: PASS. Then `npx tsc -b` clean.

```bash
git add src/client/board test/client/components.test.tsx && git commit -m "feat: sort-by-votes toggle, share button, max-votes setting"
```

---

## Task 21: Manual integration run (dev) + wire dnd-kit draggables

**Files:**
- Modify: `src/client/board/Column.tsx`, `src/client/board/Card.tsx` (add `useDraggable`/`useDroppable` + `data.current = { columnId, index }`)

**Interfaces:** no new exports; completes the dnd-kit wiring referenced in Task 19.

- [ ] **Step 1: Add dnd-kit hooks to Card (draggable) and Column (droppable per slot)**

Wrap each `Card` with `useDraggable({ id: card.id })` and set `attributes`/`listeners`/`transform`; make each column a `useDroppable({ id: col.id, data: { columnId: col.id } })`, and tag each card slot with `data: { columnId, index }` so `onDragEnd` can read the target index. (Standard @dnd-kit/sortable `SortableContext` per column is the cleanest; follow its docs.)

- [ ] **Step 2: Run the app and smoke-test manually**

```bash
npm run build && npm run dev   # wrangler dev serves dist + worker + DO + local D1
```
Apply local D1 schema first if needed: `npx wrangler d1 execute open-retro --local --file=src/worker/db/schema.sql`. Set `.dev.vars` with `AUTH_TEST_MODE=1` and `RESEND_API_KEY=dummy`. Open the printed URL, request a magic link, copy `devUrl` from the JSON response (test mode), verify, create a board, add/vote/drag cards. Open a second browser profile to the shared link to confirm realtime.

- [ ] **Step 3: Commit**

```bash
git add src/client/board && git commit -m "feat: wire @dnd-kit draggable cards and droppable columns"
```

---

## Task 22: Resend wiring, email rate limiting, cleanup cron

**Files:**
- Create: `src/worker/auth/rateLimit.ts`
- Modify: `src/worker/auth/routes.ts` (apply rate limit), `src/worker/index.ts` (scheduled handler), `wrangler.jsonc` (cron trigger), `.dev.vars`
- Test: `test/worker/auth.test.ts` (append rate-limit test)

**Interfaces:**
- Produces: `tooManyRecently(env, email): Promise<boolean>` (≥5 tokens in trailing hour ⇒ true); `scheduled()` handler deleting expired tokens/sessions.

- [ ] **Step 1: Write the failing rate-limit test**

```typescript
import { tooManyRecently } from '../../src/worker/auth/rateLimit';
it('flags more than 5 requests per email per hour', async () => {
  await env.DB.exec('DELETE FROM magic_tokens');
  for (let i = 0; i < 5; i++) await issueToken(env, 'spam@x.com');
  expect(await tooManyRecently(env, 'spam@x.com')).toBe(true);
  expect(await tooManyRecently(env, 'other@x.com')).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `npm test -- auth` → Expected: FAIL.

- [ ] **Step 3: Implement rate limit + apply in route + scheduled cleanup + cron config**

```typescript
// src/worker/auth/rateLimit.ts
import type { Env } from '../types';
export async function tooManyRecently(env: Env, email: string): Promise<boolean> {
  const since = Date.now() - 60 * 60 * 1000;
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM magic_tokens WHERE email=? AND created_at > ?')
    .bind(email.toLowerCase(), since).first<{ n: number }>();
  return (r?.n ?? 0) >= 5;
}
```

In `auth/routes.ts` `/request`, before issuing: `if (email && (await tooManyRecently(c.env, email))) return c.json({ ok: true });` (still uniform response — silently drop).

In `src/worker/index.ts`, export a scheduled handler alongside the Hono app:
```typescript
const worker = {
  fetch: app.fetch,
  async scheduled(_e: ScheduledController, env: Env) {
    const now = Date.now();
    await env.DB.prepare('DELETE FROM magic_tokens WHERE expires_at < ?').bind(now).run();
    await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now).run();
  },
};
export default worker;
export { BoardRoom } from './boardroom/boardroom';
```

In `wrangler.jsonc` add: `"triggers": { "crons": ["0 * * * *"] }`.

- [ ] **Step 4: Run to verify pass + commit** — Run: `npm test -- auth` → Expected: PASS.

```bash
git add src/worker test/worker/auth.test.ts wrangler.jsonc && git commit -m "feat: per-email rate limit + scheduled token/session cleanup"
```

---

## Task 23: Styling pass (minimal, EasyRetro-like layout)

**Files:**
- Create: `src/client/styles.css`
- Modify: `src/client/main.tsx` (import css), components (className usage already present)

**Interfaces:** none. Visual only.

- [ ] **Step 1: Add a minimal stylesheet** — three/four columns side by side, card styling, header bar. (No test; verified visually in Task 21's dev run and Task 24's E2E screenshots.)

```css
/* src/client/styles.css */
:root { font-family: system-ui, sans-serif; }
.columns { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 16px; padding: 16px; }
.column { background: #f4f5f7; border-radius: 8px; padding: 12px; }
.card { background: #fff; border-radius: 6px; padding: 8px; margin: 8px 0; box-shadow: 0 1px 2px rgba(0,0,0,.1); }
.card footer { display: flex; gap: 8px; align-items: center; font-size: 12px; color: #555; }
.board-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px,1fr)); gap: 16px; }
```

- [ ] **Step 2: Import in `main.tsx`** — `import './styles.css';`

- [ ] **Step 3: Build + commit** — Run: `npm run build` → Expected: clean.

```bash
git add src/client/styles.css src/client/main.tsx && git commit -m "feat: minimal column/card styling"
```

---

## Task 24: Playwright E2E — golden path + two-client realtime

**Files:**
- Create: `playwright.config.ts`, `e2e/golden-path.spec.ts`, `e2e/two-client.spec.ts`
- Modify: `package.json` (already has `e2e` script)

**Interfaces:** runs against a single `wrangler dev` process (`webServer` in config). Magic-link token read from the `devUrl` field returned by `/api/auth/request` when `AUTH_TEST_MODE=1`.

- [ ] **Step 1: Write `playwright.config.ts`**

```typescript
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  webServer: {
    command: 'npm run build && npx wrangler dev --port 8787 --var AUTH_TEST_MODE:1',
    url: 'http://localhost:8787', reuseExistingServer: !process.env.CI, timeout: 120_000,
  },
  use: { baseURL: 'http://localhost:8787' },
});
```

> Before first run, apply local D1 schema: `npx wrangler d1 execute open-retro --local --file=src/worker/db/schema.sql`.

- [ ] **Step 2: Write the golden-path test**

```typescript
// e2e/golden-path.spec.ts
import { test, expect, request } from '@playwright/test';
async function login(page, email: string) {
  const ctx = await request.newContext({ baseURL: 'http://localhost:8787' });
  const res = await ctx.post('/api/auth/request', { data: { email } });
  const { devUrl } = await res.json();
  await page.goto(devUrl); // verify link sets the cookie and redirects to /
  await expect(page).toHaveURL('http://localhost:8787/');
}

test('create board, add card, vote, see it', async ({ page }) => {
  await login(page, 'golden@x.com');
  await page.getByRole('button', { name: /add board/i }).click();
  await page.getByLabel(/name/i).fill('E2E Retro');
  await page.getByLabel(/template/i).selectOption('three_little_pigs');
  await page.getByRole('button', { name: /create/i }).click();
  await expect(page).toHaveURL(/\/b\//);
  const add = page.getByLabel('add card').first();
  await add.fill('ship it'); await add.press('Enter');
  await expect(page.getByText('ship it')).toBeVisible();
  await page.getByLabel('upvote').first().click();
  await expect(page.getByLabel('votes').first()).toHaveText('1');
});
```

- [ ] **Step 3: Write the two-client realtime test**

```typescript
// e2e/two-client.spec.ts
import { test, expect, request, chromium } from '@playwright/test';
test('a card added by client A appears for client B', async () => {
  const browser = await chromium.launch();
  const a = await browser.newContext(); const b = await browser.newContext();
  const pageA = await a.newPage(); const pageB = await b.newPage();
  const sign = async (page, email: string) => {
    const ctx = await request.newContext({ baseURL: 'http://localhost:8787' });
    const { devUrl } = await (await ctx.post('/api/auth/request', { data: { email } })).json();
    await page.goto(devUrl);
  };
  await sign(pageA, 'a@x.com'); await sign(pageB, 'b@x.com');

  // A creates a board
  await pageA.getByRole('button', { name: /add board/i }).click();
  await pageA.getByLabel(/name/i).fill('Shared');
  await pageA.getByRole('button', { name: /create/i }).click();
  await expect(pageA).toHaveURL(/\/b\//);
  const url = pageA.url();

  // B opens the same link (joins), then A adds a card
  await pageB.goto(url);
  await expect(pageB.getByRole('heading', { name: /House of Straws/i })).toBeVisible();
  const add = pageA.getByLabel('add card').first();
  await add.fill('realtime!'); await add.press('Enter');

  await expect(pageB.getByText('realtime!')).toBeVisible({ timeout: 5000 });
  await browser.close();
});
```

- [ ] **Step 4: Run E2E + commit** — Run: `npm run e2e` → Expected: 2 specs PASS.

```bash
git add playwright.config.ts e2e && git commit -m "test: playwright golden-path and two-client realtime E2E"
```

---

## Task 25: README + deploy notes

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`** with: local dev (`npm i`, create D1, apply schema, `.dev.vars`, `npm run dev`), test commands (`npm test`, `npm run test:ws`, `npm run test:client`, `npm run e2e`), and deploy steps (`wrangler secret put RESEND_API_KEY`, set `APP_ORIGIN` var to the prod URL, Resend verified-domain reminder, `npm run build && npx wrangler deploy`, apply schema to remote D1 with `wrangler d1 execute open-retro --remote --file=src/worker/db/schema.sql`).

- [ ] **Step 2: Commit**

```bash
git add README.md && git commit -m "docs: README with dev, test, and deploy instructions"
```

---

## Self-Review (completed)

**1. Spec coverage** — every spec section maps to a task:
- §1 features: list (T18), create (T18), magic-link auth (T4–6,17), templates (T2), voting (T11), sort-by-votes (T20), drag reorder+move (T19,21). Presence deferred (spec §1).
- §4 data model: D1 (T3), DO SQLite (T9–12).
- §5 auth hardening: hashing/atomic-consume/uniform-200/no-URL-log/hardcoded-redirect (T5,6); cleanup cron (T22).
- §6 membership: join (T8), side-effect-free WS authz (T14).
- §7 protocol + idempotent folds: (T2 types, T15 reducer, T16 hook).
- §8 DO invariants: no-await critical sections + atomic vote SQL + move/renormalize + set_max_votes + hibernation broadcast (T11,12,13).
- §9 frontend incl. drag-disabled-while-sorted (T19,20).
- §10 security: origin checks (T6,14), rate limit (T22), input validation (T7,10,12), secrets (T1,22).
- §11 wrangler config (T1,22). §12 testing split worker/worker-ws/client + E2E (T1,9,14,15,24). §13 hardening table all covered.

**2. Placeholder scan** — no "TBD/TODO"; every code step has concrete code. Two intentional cross-task stubs are explicitly called out (empty BoardList/BoardView exports in T17 to keep the build green; dnd-kit hook wiring completed in T21).

**3. Type consistency** — `ServerMessage`/`ClientMessage`/`Card`/`BoardSnapshot`/`ActionResult`/`Identity` defined once in T2 and imported unchanged everywhere. Handler signatures `(db, actor, payload) => ActionResult` consistent T10–12. `BoardDb` method names (`voteAtomic`, `voteTotal`, `userVoteCount`, `moveCard`, `setMaxVotes`, `snapshot`, `columnExists`) consistent between definition (T9–12) and DO usage (T13). Reducer/hook action names (`addCard`, `vote`, `unvote`, `moveCard`, `setMaxVotes`) consistent T16/T19/T20.

**Known soft spots to verify against installed versions at execution time** (flagged, not placeholders): exact `@cloudflare/vitest-pool-workers` import surface (`SELF` vs `exports`) and no-isolate config keys; whether the test D1 needs an explicit schema-apply setup file. Both have documented fallbacks in T1/T3.
