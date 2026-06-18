# open-retro — Design Spec

**Date:** 2026-06-18
**Status:** Approved — ready for implementation planning

A deliberately small, real-time collaborative retrospective board (an EasyRetro clone). This spec is the validated design; it has been hardened by a four-lens design review (Cloudflare platform correctness, auth/security, realtime correctness, testing). Findings from that review are folded into the relevant sections below and summarized in **§13 Hardening decisions**.

---

## 1. Scope

**In scope (v1):**

1. Board list page (your boards).
2. Create a board: name, max votes, template.
3. Magic-link email authentication. **Login is required** to view or use any board.
4. Exactly two templates:
   - **Three Little Pigs** — 3 columns: *House of Straws* / *House of Sticks* / *House of Bricks*.
   - **Sailboat** — 4 columns: *Wind* / *Anchors* / *Rocks* / *Island*.
5. Voting: **multiple votes per card**, capped by a board-wide **per-user budget** (`max_votes`).
6. Sort-by-votes — a per-viewer view toggle.
7. Drag to reorder within a column **and** move across columns.

**Explicitly out of scope (YAGNI):** teams, analytics, action items, integrations, subscriptions, card grouping/merging, comments, timers, export, anonymous/guest access, card reveal/hide phases, custom templates.

**Deferred (documented, not silent):** **presence** ("who's online") is cut from v1. It is a trivial later add-on because `ctx.getWebSockets()` + connection attachments already hold the data. The board is credibly real-time without it (cards/votes/moves propagate live).

---

## 2. Tech stack & deployment

- **Frontend:** Vite + React SPA (TypeScript), built to static assets, served **by the Worker** via Workers Static Assets.
- **Worker (single entry point):** serves the SPA, exposes `/api/*` (auth + board CRUD + join), and upgrades `GET /api/boards/:id/ws` to a WebSocket forwarded into that board's Durable Object.
- **`BoardRoom` Durable Object (one per board):** SQLite storage backend (`new_sqlite_classes`). Owns all live board state, validates every action in a no-await synchronous critical section, broadcasts changes, uses the WebSocket Hibernation API.
- **Cloudflare D1:** auth + board registry only.
- **Resend:** magic-link email via its HTTP API (Workers can't open raw SMTP).
- **Repo:** standalone `open-retro/` (its own git repo).

**Plan note:** SQLite-backed DOs and the WebSocket Hibernation API are usable on the Workers **Free** plan (account-wide DO storage capped at 5 GB; per-object 10 GB requires **Paid**). Board state is tiny relative to these caps. **Target plan: Workers Paid** (the account already has it) — per-object 10 GB SQLite, no Free-plan DO storage limits to design around.

---

## 3. Architecture & data flow

```
Browser (Vite React SPA)
  │  HTTPS  /            → Worker → Static Assets (SPA shell, SPA fallback)
  │  HTTPS  /api/auth/*  → Worker → D1 (users, sessions, magic_tokens) + Resend
  │  HTTPS  /api/boards* → Worker → D1 (boards, board_members)
  │  WSS    /api/boards/:id/ws
  │            → Worker: validate session cookie + Origin + membership (D1)
  │            → forward upgrade to BoardRoom DO via idFromName(boardId),
  │              passing {userId, displayName, template, maxVotes} as headers
  └──────────────────────────────────────────────┐
                                                   ▼
                          BoardRoom DO (one per board, SQLite)
                            • acceptWebSocket (hibernatable), attach identity
                            • seed SQLite from headers on first connect
                            • validate+apply each action atomically (no-await)
                            • broadcast patches to ctx.getWebSockets()
                            • set_max_votes write-through to D1 via ctx.waitUntil
```

**Key boundary:** the **Worker** does all authn/authz against D1 *before* forwarding the upgrade, so unauthorized requests never reach (or bill) the DO. The **DO trusts the Worker-attached identity** and never reads identity from the client message body.

---

## 4. Data model

### 4.1 D1 (auth + board registry)

- `users` — `id` (TEXT PK), `email` (UNIQUE), `display_name`, `created_at`
- `sessions` — `id_hash` (PK), `user_id`, `expires_at`, `created_at`
- `magic_tokens` — `token_hash` (PK), `email`, `expires_at`, `consumed_at`, `created_at`
- `boards` — `id` (PK), `name`, `owner_id`, `template` (`three_little_pigs` | `sailboat`), `max_votes`, `created_at`
- `board_members` — `board_id`, `user_id`, `role` (`owner` | `member`), `joined_at`, PK (`board_id`, `user_id`)

Notes: store **hashes** (SHA-256) of session ids and magic tokens, never the raw value (a D1 read leak then can't be replayed into logins). `boards.max_votes` is a denormalized mirror for list display and DO seeding; the DO's `meta` row is authoritative for live edits.

### 4.2 SQLite inside each `BoardRoom` DO (the live retro)

- `meta` — single row: `template`, `max_votes`, `seeded` (idempotency flag)
- `columns` — `id`, `title`, `subtitle`, `position`  *(seeded from template)*
- `cards` — `id` (client-generated UUID), `column_id`, `text`, `author_id`, `author_name`, `position REAL`, `created_at`
- `votes` — `card_id`, `user_id`, `count INTEGER`, PK (`card_id`, `user_id`)

**Ordering:** `position REAL` with midpoint insertion. **Always `ORDER BY position, created_at, id`** so exact ties still sort deterministically across all clients. Seed initial positions with large gaps (e.g. `n * 1024`) to delay the first renormalization.

**Card deletion does not rely on FK cascade** (SQLite FK enforcement inside DO SQLite is not a guarantee to design correctness around). `delete_card` runs `DELETE FROM votes WHERE card_id=?` then `DELETE FROM cards WHERE id=?` synchronously in the same handler (one implicit transaction), then broadcasts `card_deleted`. This deterministically frees every user's budget.

---

## 5. Authentication & sessions (magic link)

**Endpoints:**

- `POST /api/auth/request {email}` → always returns a uniform `200` ("If that email exists, check your inbox") regardless of whether the user exists (no account enumeration). Generates a ≥128-bit CSPRNG token (`crypto.getRandomValues`), stores **only its SHA-256 hash** with a short expiry (5–10 min), emails a `/auth/verify?token=…` link via Resend.
- `GET /api/auth/verify?token` → consumes the token with a **single atomic** `UPDATE magic_tokens SET consumed_at=? WHERE token_hash=? AND consumed_at IS NULL AND expires_at > ?` and checks rows-changed == 1 (closes the double-redemption race). Upserts the user, mints a **new** session (≥128-bit id, hash stored), sets the cookie, then redirects to a **hardcoded `/`** (never a query-param target — no open redirect). The handler must **not log `request.url`** (keeps single-use tokens out of access logs).
- `POST /api/auth/logout` → deletes the session row, clears the cookie.

**Session cookie:** `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=<lifetime>`. Lax (not Strict) so the magic-link top-level GET lands authenticated. Sessions are **server-side/stateful** (row in D1, looked up on every request) — real logout/revocation; cookie lifetime is not trusted alone, expiry is enforced server-side.

**Email-scanner caveat:** corporate link-prefetchers (SafeLinks, etc.) may consume a single-use token before the human clicks. Acceptable for v1 given short expiry + atomic consume; if it bites real users, add a POST-confirm interstitial later.

**Cleanup:** a Cron Trigger periodically deletes expired `magic_tokens` and `sessions` (table hygiene + reduced attack window).

---

## 6. Authorization & membership

**Decision (confirm at review):** boards are **link-shareable among authenticated users** — matching EasyRetro's "Share URL" model, but every participant must be logged in. Anyone with the board URL who is logged in may join.

- Joining is an **explicit `POST /api/boards/:id/join`** (CSRF-protected). It inserts the `board_members` row. The board creator is auto-added as `owner` at creation.
- The **WS upgrade (`GET …/ws`) is side-effect-free**: it authorizes an *existing* owner/member and rejects everyone else with `403`. It never inserts membership. (A GET handshake that mutates state is a Cross-Site WebSocket Hijacking vector — separating the idempotent socket-open from the state-changing join closes it.)
- Frontend flow for opening `/b/:id`: `POST join` (idempotent; 200 if already a member, inserts if you have the link) → then open the WS.

Alternative if you'd prefer tighter control: **invite-only** (owner explicitly adds members; non-members get 403 with no auto-join). Noted for the review gate.

---

## 7. Realtime protocol

WebSocket JSON messages. The DO derives `userId`/`displayName` **exclusively** from the socket attachment (server-set, spoof-proof); client messages carry only action params, never identity.

**Client → DO:**

- `add_card { clientCardId, columnId, text }` — `clientCardId` is a client-generated UUID (makes optimistic create idempotent)
- `edit_card { cardId, text }`
- `delete_card { cardId }`
- `move_card { cardId, toColumnId, beforeId?, afterId? }`
- `vote { cardId }` / `unvote { cardId }`
- `set_max_votes { n }` (owner only)

**DO → client:**

- `init { meta, columns, cards[], yourVotes }` — full snapshot built **synchronously on connect**, including the requesting user's own per-card votes
- `card_added { card }` (carries `clientCardId` so the actor reconciles its optimistic card)
- `card_edited { cardId, text }`
- `card_deleted { cardId }`
- `card_moved { cardId, columnId, position }` (the **final authoritative** position)
- `votes_changed { cardId, total }` to everyone; the **acting voter additionally** gets `yourCount` (so their remaining budget stays exact)
- `max_votes_changed { maxVotes }`
- `error { code, msg }` (e.g. `budget_exceeded`, `forbidden`, `stale_move`)

**Client reconciliation rules (idempotent, set-based — prevents echo/duplicate-apply):**

- `card_added` = **upsert by id** (replace optimistic card in place, never append a duplicate)
- `card_deleted` = delete-if-present
- `votes_changed` = **set** the total (never `+=`)
- Patches arriving **before** `init` are ignored/queued; on reconnect, state is **replaced wholesale** by the fresh `init` (optimistic/in-flight state is dropped — un-acked actions at disconnect are lost; acceptable for this scope).

**Remaining budget** = `max_votes − (sum of your own counts)`, computed client-side from `yourVotes`/`yourCount`, clamped to ≥0. The DO is the hard guard; the client value is advisory UX.

---

## 8. Durable Object correctness invariants

These are **load-bearing** — the design's atomicity guarantees depend on them, and they are enforced by tests (§12).

1. **No-await critical sections.** Each action does read → validate → write via the **synchronous** SQLite API (`ctx.storage.sql.exec`) with **no `await` between the read and the write**. Awaiting non-storage I/O (D1, fetch, async broadcast) opens the input gate and lets another message interleave. Async work (D1 mirror, anything awaited) happens *after* the synchronous critical section.

2. **Vote budget as one conditional statement** (eliminates TOCTOU entirely):
   ```sql
   INSERT INTO votes(card_id, user_id, count) VALUES(?, ?, 1)
   ON CONFLICT(card_id, user_id) DO UPDATE SET count = count + 1
   WHERE (SELECT COALESCE(SUM(count),0) FROM votes WHERE user_id=?1)
         < (SELECT max_votes FROM meta);
   ```
   Inspect rows-written: 0 ⇒ reject with `error{budget_exceeded}`; 1 ⇒ broadcast new total + `yourCount`. `unvote` always succeeds when count > 0 (decrement, delete row at 0), regardless of budget.

3. **`set_max_votes`:** owner-checked from the socket attachment (not the message). Update the DO `meta` row **synchronously** and broadcast `max_votes_changed` immediately; persist to D1 **best-effort** via `ctx.waitUntil()` (eventually-consistent mirror, never an awaited dependency of the action). **Lowering below a user's current spend** leaves existing votes intact and simply blocks new votes until they're back under budget (the `WHERE … < max_votes` guard enforces this naturally); UI clamps remaining to 0.

4. **`move_card`:** look up the **current stored positions** of `beforeId`/`afterId` at processing time (don't trust client-sent positions). Handle: neighbor deleted (fall back to the other / end-of-column), neighbor now in a different column (reject `stale_move`, client re-syncs), empty target (default position). Compute midpoint in the synchronous section; if the gap underflows (neighbors equal or within ~1e-9), **renormalize** the column (rewrite positions to large even gaps in one transaction) and broadcast. Broadcast `card_moved` with the final position so all clients converge.

5. **Seeding:** prefer seeding from the `{template, maxVotes}` headers the Worker passes on the first upgrade (the Worker already read the board row to authorize) — **no D1 read in the DO**. Do the one-time seed in `ctx.blockConcurrencyWhile()` during construction (synchronous `CREATE TABLE IF NOT EXISTS` + check/set the `seeded` flag) so the first message can't race it.

6. **Hibernation safety:** keep **no authoritative in-memory state**. Enumerate sockets for broadcast via `ctx.getWebSockets()`, read identity via `ws.deserializeAttachment()`, and recompute tallies from SQL at send time. The attachment holds **identity only** (well under the 16 KiB cap).

7. **Socket-independent handlers (testability):** `webSocketMessage` is a thin parse → dispatch → broadcast shell; each action is a plain method `handleX({userId, displayName, payload}) → patches[]` callable without a socket (see §12).

---

## 9. Frontend (Vite React SPA)

**Routes (React Router):** `/login`, `/` (board list), `/b/:id` (board view). SPA fallback served by the Worker for deep links like `/b/:id`.

**Components:** `BoardList` + `BoardCard` + `CreateBoardModal` (name, max votes, 2-template picker) · `BoardView` · `Column` · `Card` (text, author, vote ±, edit/delete if author/owner) · `AddCardInput` · `SortToggle` · `ShareButton` (copy URL) · `MaxVotesSetting` (owner).

**Core hook `useBoardSocket(boardId)`:** owns a `useReducer` state; opens the WS; folds incoming events with the idempotent set-based rules (§7); exposes typed action senders with **optimistic** local application (client-generated card ids); reconnects with backoff and re-syncs by **replacing** state from a fresh `init`.

**Drag & drop:** `@dnd-kit` (`core` + `sortable`) for reorder + cross-column. On drop, send `move_card` with the **position-order** neighbor ids.

**Sort-by-votes:** pure client render-order transform (persisted in `localStorage` per board); never reads/writes `position`. **Drag is disabled while sort-by-votes is active** (so neighbor ids always reflect stored position order, never vote order) — re-enabled when toggled off.

---

## 10. Security checklist

- **CSRF / CSWSH:** SameSite=Lax + **validate the `Origin` header** on every mutating `/api` request **and on the WS upgrade** (reject foreign origins). All state changes are `POST`/`DELETE`, never `GET` (the WS upgrade is side-effect-free per §6).
- **Rate limiting:** native Workers Rate Limiting (per-colo, 10s/60s windows) as a cheap per-IP first layer; the **hard per-email/hour cap is a D1-based global counter** (count tokens issued to that email in the trailing hour) — the native binding cannot express a global hourly cap.
- **Enumeration:** uniform `200` on `/api/auth/request`.
- **Input validation (boundary):** cap card text length; bound `max_votes` to a small positive integer in **both** create-board (D1) and `set_max_votes` (DO); require `column_id` to exist in the board; cap board name length; per-user board-creation cap.
- **Secrets:** `RESEND_API_KEY` via `wrangler secret put` (never in `wrangler.jsonc`). Resend `from` must be a **verified domain** (DKIM/SPF/DMARC in Cloudflare DNS); handle non-2xx Resend responses without leaking whether the email exists.
- **Identity:** card/vote attribution comes only from the socket attachment; a forged `author_id`/`user_id` in a payload is ignored (asserted by test).

---

## 11. Cloudflare configuration

`wrangler.jsonc` essentials:

- **Static Assets:** `assets` binding pointing at Vite `dist/`, `not_found_handling: "single-page-application"` (SPA fallback → `index.html` with 200), and `run_worker_first: ["/api/*"]` so `/api` and the `/ws` upgrade reach the Worker while everything else serves the SPA directly (fewer billable invocations).
- **Durable Objects:** `new_sqlite_classes: ["BoardRoom"]` in the migration (**not** `new_classes` — that's the retired KV backend and is **not convertible** later).
- **D1 binding** (`env.DB`) and the **DO namespace binding** on the Worker.
- Compat date recent enough for current hibernation behavior.

---

## 12. Testing strategy (TDD, RED-first)

**Critical constraint:** `@cloudflare/vitest-pool-workers` does **not** support WebSockets with per-file storage isolation. So:

- **`boardroom.handlers.test.ts`** (the bulk): exercise the **socket-independent action methods** (§8.7) via `runInDurableObject` under normal isolation — vote budget, author/owner authz, midpoint reorder, delete-frees-votes, `set_max_votes` semantics. Assert exact serialized patch payloads to lock the protocol contract.
- **`boardroom.ws.test.ts`** (thin): real WS transport — accept upgrade, `init` on connect, broadcast fan-out to 2 sockets — run under `--max-workers=1 --no-isolate` with manual table reset in `beforeEach`. Separate npm script (`test:ws`) makes the constraint explicit.

**Per-test hygiene:** isolation is **per file**, not per test (`isolatedStorage`/`singleWorker` removed in pool ≥0.13). Use a fresh DO id per test (`newUniqueId()` / unique `idFromName`) and truncate D1 registry tables in `beforeEach`. Always `await` every storage op and consume Response bodies (a floating promise surfaces as a flaky test, not a clear error).

**RED-first order (riskiest = data-loss/security first):**
1. **Vote budget** — vote to cap succeeds; next vote → `error{budget_exceeded}` and **writes nothing**; a deliberate **two-rapid-votes race** asserting no overspend; unvote frees budget; multi-vote on one card counts toward the cap.
2. **Authz** — non-author edit/delete rejected; owner can delete others' cards; non-owner `set_max_votes` rejected; forged `author_id` ignored.
3. **Midpoint reorder** — head/tail/between; **precision-tie → renormalization**; stale-neighbor handling; concurrent moves.
4. **Frontend reducer** (pure, highest-value): optimistic add → `card_added` with real id (dedupe, no double-render); optimistic vote → `votes_changed` with a *different* total (server wins); `error` rolls back the optimistic change; `init` replaces all state on reconnect.
5. **Auth/session middleware** — `/api/*` returns 401 without a valid cookie; magic-token single-use + expiry; uniform 200 on request.

**Tooling notes:** frontend uses **Vitest + happy-dom + @testing-library/react** with a **hand fake WebSocket** (push server frames in) — keep Vitest for everything Worker-adjacent and the frontend (this project is **not** bun:test). Integration fetch via the current `exports` import from `cloudflare:workers` (pool ≥0.13 / Vitest v4 replaced `SELF`); note `exports` does **not** serve Static Assets, so assert SPA serving via `startDevWorker`/Playwright instead. **Pin** the `@cloudflare/vitest-pool-workers` + `vitest` versions in the plan.

**E2E (Playwright, recommended):** golden path (magic-link login → create → add cards → vote to budget → drag across columns) + a **two-client** realtime-propagation test. Run against a **single `wrangler dev`** process (both browser contexts must hit the same DO via `idFromName`); gate actions on the WS `init` frame; use `expect.poll` for broadcast latency. **Magic-link in CI:** never send real email — read the token from D1 (`AUTH_TEST_MODE` exposing it, or `wrangler d1 execute --local`); prefer reading the real token row.

---

## 13. Hardening decisions (from design review)

| # | Issue | Severity | Resolution |
|---|-------|----------|------------|
| 1 | Vote-budget TOCTOU (input gate opens on non-storage await) | **critical** | One conditional SQL statement; no-await critical sections (§8.1–2) |
| 2 | WS + storage isolation incompatible in test harness | **critical** | Socket-independent handlers + split test files (§8.7, §12) |
| 3 | DO→D1 write-through stalls actor + dual-write divergence | high | Worker/`ctx.waitUntil` owns D1; DO meta authoritative (§8.3) |
| 4 | Lazy-seed double-seed race | high | Seed from Worker-passed headers in `blockConcurrencyWhile` (§8.5) |
| 5 | "Login required" ≠ authorization; CSWSH via GET handshake | high | Explicit CSRF-protected `POST join`; side-effect-free WS upgrade; Origin checks (§6, §10) |
| 6 | `votes_changed` lacks own-count → budget drift | high | Targeted `yourCount` to actor; `yourVotes` in `init` (§7) |
| 7 | Optimistic echo/duplicate-apply | high | Client-generated ids; idempotent set-based folds (§7) |
| 8 | Magic-token leakage / open-redirect / enumeration | high | Hash + short expiry + atomic consume; hardcoded redirect; uniform 200; no URL logging (§5, §10) |
| 9 | Email-bombing not stoppable by per-colo rate limiter | high | D1 global per-email/hour counter (§10) |
| 10 | Card delete relying on FK cascade | high | Explicit `DELETE votes` then `DELETE cards` (§4.2) |
| 11 | init/patch ordering race | high | Sync snapshot before any await; ignore pre-init patches; replace on reconnect (§7, §8.6) |
| 12 | Fractional-position precision exhaustion | medium | Renormalize on underflow; `ORDER BY position, created_at, id`; large initial gaps (§4.2, §8.4) |
| 13 | Hibernation in-memory state loss | medium | No in-memory authoritative state; `getWebSockets()` + attachment + SQL (§8.6) |
| 14 | Sort-by-votes vs drag neighbor mismatch | medium | Disable drag while sorted (§9) |
| 15 | Presence unspecified | low | Explicitly deferred (§1) |

---

## 14. Build sequence (high level)

Detailed task breakdown comes from the writing-plans step. Rough order:

1. Repo scaffold: Vite React SPA + Worker entry + `wrangler.jsonc` (assets, DO, D1, migration) + Vitest pool config.
2. D1 schema + migrations; auth (magic link + sessions + middleware) — TDD.
3. Board CRUD + membership (`POST join`) in the Worker — TDD.
4. `BoardRoom` DO: SQLite schema/seeding, socket-independent action handlers (vote/edit/delete/move/set_max_votes) — TDD (the critical-path tests).
5. WS transport layer: upgrade routing, hibernation accept, init snapshot, broadcast — thin `test:ws`.
6. Frontend: `useBoardSocket` + reducer (TDD) → board list / create / board view → `@dnd-kit` drag → sort toggle → share/settings.
7. Resend integration + rate limiting + cleanup cron.
8. Playwright golden-path + two-client E2E.

---

## 15. Decisions (confirmed)

1. **Membership model (§6):** **link-shareable among logged-in users** — confirmed. Sharing the board URL lets any logged-in user join via the explicit `POST join`; the WS upgrade authorizes existing members only.
2. **Target plan (§2):** **Workers Paid** — confirmed (account already on Paid).
3. **Scope:** §1 as written, no additions to v1.
