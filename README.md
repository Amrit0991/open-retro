# open-retro

A small real-time collaborative retrospective board — an [EasyRetro](https://easyretro.io)-style
clone you can self-host on Cloudflare's edge.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Amrit0991/open-retro)

> The Deploy button requires a **public** repo and the **Workers Paid** plan, and needs three
> post-deploy settings (`APP_ORIGIN`, email `DOMAIN`, schema seed). See [Deployment](#deployment).

## Overview

- **Frontend:** a Vite + React single-page app.
- **Server:** a Cloudflare Worker (Hono) that serves the SPA, exposes the auth/board JSON API,
  and upgrades board WebSockets.
- **Live state:** one SQLite-backed `BoardRoom` Durable Object per board. It owns the live
  cards / votes / columns and the set of connected WebSocket clients.
- **Persistence & registry:** Cloudflare D1 holds auth (users, sessions, magic tokens) and the
  board registry (boards + memberships).
- **Email:** [Cloudflare Email Service](https://developers.cloudflare.com/email-service/) sends
  magic-link login emails via the Worker's `EMAIL` send binding — no third-party service or API key.

### Features

- Magic-link login (passwordless email).
- Create a board from one of two templates: **Three Little Pigs** and **Sailboat**.
- Add / edit / delete cards in real time across all connected clients.
- Vote on cards with a per-user vote budget (the board owner can change the max).
- Sort a column by votes.
- Drag to reorder cards within a column or move them between columns.

## Architecture

The Worker authenticates the JSON API and gatekeeps the WebSocket upgrade: it validates the
**session**, checks the **request origin**, and confirms board **membership** before forwarding the
WS upgrade into the board's `BoardRoom` Durable Object. The DO is the single source of truth — it
validates every action atomically against its embedded SQLite, then broadcasts the result to all
connected sockets. Because each board maps to exactly one DO instance, there are no cross-instance
races to reconcile.

```
src/
  shared/    protocol + WS message types, board templates (used by client and worker)
  client/    React SPA (auth, board list, board view, reducer, socket hook)
  worker/    Hono app, auth, boards repo/routes, the BoardRoom DO, D1 schema
```

## Local development

Requires Node 18+ and npm. No Cloudflare account is needed for local dev — Wrangler runs a local
Miniflare D1 and Durable Object.

### 1. Install

```bash
npm install
```

### 2. Create the local D1 and apply the schema

```bash
npx wrangler d1 execute open-retro --local --file=src/worker/db/schema.sql
```

This creates the local Miniflare D1 database and applies the tables. No Cloudflare auth is required
for the `--local` flag.

### 3. Configure local vars

Create a `.dev.vars` file (gitignored) at the repo root:

```ini
AUTH_TEST_MODE=1          # skips real email; see below
```

No email credentials are needed for local dev. With `AUTH_TEST_MODE=1`, `POST /api/auth/request`
skips sending email and returns a `devUrl` in its JSON response. Open that URL in the browser to log
in without sending real email. You can also pass this flag on the CLI instead of `.dev.vars`:
`npm run dev -- --var AUTH_TEST_MODE:1`.

### 4. Build and run

```bash
npm run build      # vite build → dist/ (served by the Worker as static assets)
npm run dev        # wrangler dev (default http://localhost:8787)
```

`npm run dev` serves the built SPA from `dist/`, so re-run `npm run build` after frontend changes.

## Tests

| Command              | What it covers                                                         |
| -------------------- | ---------------------------------------------------------------------- |
| `npm test`           | Worker / Durable Object / D1 logic via `@cloudflare/vitest-pool-workers` |
| `npm run test:ws`    | WebSocket transport (run no-isolate / single-worker — see note below)  |
| `npm run test:client`| React reducer, `useBoardSocket` hook, and components (happy-dom)        |
| `npm run e2e`        | Playwright golden-path + a two-client realtime test                    |

WebSockets are incompatible with vitest-pool-workers' per-test storage isolation, so the WS suite is
split into its own project and run with `--no-isolate --max-workers=1` (already wired into the
`test:ws` script).

Before the first E2E run, install the browser:

```bash
npx playwright install chromium
```

## Deployment

The Worker, the `BoardRoom` Durable Object, and the D1 database are all declared in `wrangler.jsonc`,
so they're provisioned together. The app needs the **Workers Paid** plan (SQLite Durable Objects +
sending email to arbitrary recipients).

### One-click: Deploy to Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Amrit0991/open-retro)

The button clones the repo into your own GitHub account, **auto-provisions the D1 database and the
Durable Object** (reading `wrangler.jsonc` and writing back the real resource IDs), runs the `build`
script, then runs the `deploy` script — which **seeds the D1 schema** and `wrangler deploy`s. It
**only works on a public repository.**

Three things the button can't do for you — set them after the first deploy, then redeploy:

1. **`APP_ORIGIN`** — set this var to your deployed **https** URL. The session cookie is only marked
   `Secure` when `APP_ORIGIN` is `https`, and magic-link URLs are built from it, so auth won't work
   until this points at the real origin.
2. **Email domain + `DOMAIN`** — onboard a sending domain under **Email → Email Service** (Cloudflare
   auto-adds MX / SPF / DKIM / DMARC) and set the `DOMAIN` var to it; the magic-link `from` is
   `login@${DOMAIN}`, so it must be on the onboarded domain.
3. **Workers Paid** — required for the SQLite Durable Object and arbitrary-recipient email.

### Manual / CLI deploy

#### 1. Create the D1 database

```bash
npx wrangler d1 create open-retro
```

Copy the printed `database_id` into `wrangler.jsonc`, replacing the `local-dev-placeholder` value.

#### 2. Onboard a sending domain and set `DOMAIN`

In the Cloudflare dashboard, onboard a sending domain under **Email → Email Service** (auto-adds the
MX / SPF / DKIM / DMARC records — instant on Cloudflare-managed DNS, up to ~24h elsewhere). Set the
`DOMAIN` var in `wrangler.jsonc` to that domain. No API key or secret is needed.

#### 3. Set `APP_ORIGIN` to the production URL

Set the `APP_ORIGIN` var in `wrangler.jsonc` to your production **https** URL.

> **Important:** the session cookie's `Secure` attribute is enabled only when `APP_ORIGIN` starts
> with `https`. This lets local `http` dev work, but **production MUST use an `https` `APP_ORIGIN`**.

#### 4. Build and deploy

```bash
npm run build
npm run deploy   # seeds the D1 schema (idempotent), then `wrangler deploy`
```

The `deploy` script applies `src/worker/db/schema.sql` to the remote D1 (via the `DB` binding) before
deploying; the schema uses `CREATE TABLE IF NOT EXISTS`, so it's safe to re-run on every deploy.

## Maintenance

The Worker runs an hourly cron trigger (configured in `wrangler.jsonc`) that cleans up expired magic
tokens and sessions from D1.
