# open-retro

A small real-time collaborative retrospective board — an [EasyRetro](https://easyretro.io)-style
clone you can self-host on Cloudflare's edge.

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

You need a Cloudflare account on the **Workers Paid** plan — required to send magic-link email to
arbitrary recipients via Cloudflare Email Service — with D1 enabled.

### 1. Create the D1 database

```bash
npx wrangler d1 create open-retro
```

Copy the printed `database_id` into `wrangler.jsonc`, replacing the `local-dev-placeholder`
value under `d1_databases`.

### 2. Onboard a sending domain and set `DOMAIN`

In the Cloudflare dashboard, onboard a sending domain under **Email → Email Service**. Cloudflare
adds the required MX / SPF / DKIM / DMARC DNS records automatically (instant on Cloudflare-managed
DNS, up to ~24h elsewhere). Then set the `DOMAIN` var in `wrangler.jsonc` to that domain — the
magic-link `from` address is `login@${DOMAIN}`, so it must be on the onboarded domain. No API key or
secret is needed; sending goes through the Worker's `EMAIL` send binding.

### 3. Set `APP_ORIGIN` to the production URL

Set the `APP_ORIGIN` var in `wrangler.jsonc` to your production **https** URL.

> **Important:** the session cookie's `Secure` attribute is enabled only when `APP_ORIGIN` starts
> with `https`. This lets local `http` dev work, but **production MUST use an `https` `APP_ORIGIN`**
> or the session cookie will not be marked `Secure`.

### 4. Build and deploy

```bash
npm run build
npx wrangler deploy
```

### 5. Apply the schema to the remote D1

```bash
npx wrangler d1 execute open-retro --remote --file=src/worker/db/schema.sql
```

## Maintenance

The Worker runs an hourly cron trigger (configured in `wrangler.jsonc`) that cleans up expired magic
tokens and sessions from D1.
