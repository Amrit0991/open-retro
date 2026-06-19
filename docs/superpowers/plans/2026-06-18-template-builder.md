# Template Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each user create, edit, and delete their own retro templates (a named set of columns), and create boards from them — built-ins stay as read-only defaults.

**Architecture:** Templates become per-user data in D1. `ColumnDef` carries presentational `tone`/`icon`; boards capture an independent `template_snapshot` at creation; the Durable Object seeds columns from a snapshot the Worker passes as `x-template-json` (no hardcoded map in the DO). A `/templates` page + builder modal drive CRUD via `/api/templates`.

**Tech Stack:** TypeScript, React 19, Cloudflare Worker (Hono) + SQLite Durable Object + D1, Vitest + @cloudflare/vitest-pool-workers + happy-dom, Bun (package manager), Playwright.

Full spec: [`docs/superpowers/specs/2026-06-18-template-builder-design.md`](../specs/2026-06-18-template-builder-design.md).

## Global Constraints

- **Package manager Bun; run scripts with `bun run <name>` (never `bun test`).** Tests: `bun run test` (worker), `bun run test:ws`, `bun run test:client`. Typecheck `bun run typecheck`; build `bun run build`.
- **Preserve all existing test/E2E hooks:** `role="dialog"`, labeled `Name`/`Template`/`Max votes`, the `Add board` button text, and the `add card`/`upvote`/`votes`/`delete` aria-labels.
- **DO invariants unchanged:** seed stays a synchronous `ctx.storage.sql` operation from passed data (no D1 read in the DO); no `await` in action critical sections; one statement per `sql.exec`.
- **`Tone` lives in `src/shared/protocol.ts`** and is the single source (client `Glyph` re-exports it). Custom-column icon default is `DEFAULT_COLUMN_ICON = 'layers'`.
- **Owner-scoping:** template PUT/DELETE only affect rows where `owner_id = caller`; otherwise 404. Template routes sit behind the existing `requireSession` + `requireOrigin`.
- **Immutable updates; strict TS (`noUnusedLocals`).** Conventional commits; commit per task.

---

## Canonical reshaped types (defined in Task 1, referenced everywhere)

```ts
// src/shared/protocol.ts
export type Tone = 'green' | 'blue' | 'coral' | 'purple' | 'amber' | 'pink' | 'slate';

export interface ColumnDef { id: string; title: string; subtitle: string; tone: Tone; icon: string; }

export interface TemplateSnapshot { name: string; glyph: { tone: Tone; icon: string }; columns: ColumnDef[]; }

export interface BoardSnapshot {
  meta: { templateName: string; maxVotes: number; ownerId: string; glyph: { tone: Tone; icon: string } };
  columns: ColumnDef[];
  cards: Card[];
  yourVotes: Record<string, number>;
}

// builder/API input for one column (id + icon assigned server-side)
export interface TemplateColumnInput { title: string; subtitle: string; tone: Tone; }
// a template as returned by GET /api/templates
export interface TemplateSummary { id: string; name: string; glyph: { tone: Tone; icon: string }; columns: ColumnDef[]; readOnly: boolean; }

export const LIMITS = {
  cardText: 2000, boardName: 120, maxVotesMax: 99, boardsPerUser: 100,
  templateName: 60, columnTitle: 60, columnSubtitle: 120, templateColumnsMax: 6,
} as const;

export const DEFAULT_COLUMN_ICON = 'layers';
```

`ClientMessage`/`ServerMessage`/`Card`/`Identity`/`ActionResult` are unchanged from the existing protocol.

---

## File structure (new / modified)

```
src/shared/protocol.ts          # M: Tone, ColumnDef+tone/icon, BoardSnapshot.meta reshape, TemplateSnapshot/Summary/ColumnInput, LIMITS+, DEFAULT_COLUMN_ICON
src/shared/templates.ts         # M: TEMPLATES: Record<TemplateId, TemplateSnapshot> (glyph + columns carry tone/icon)
src/worker/db/schema.sql        # M: + templates table, + boards.template_snapshot column
src/worker/templates/repo.ts    # C: D1 template CRUD
src/worker/templates/validate.ts# C: shared template input validation
src/worker/templates/routes.ts  # C: /api/templates routes
src/worker/boards/repo.ts       # M: store template_snapshot; resolve templateName/glyph for board JSON
src/worker/boards/routes.ts     # M: resolve template ref (built-in or custom) → snapshot on create
src/worker/ws.ts                # M: pass x-template-json (resolve from template_snapshot ?? built-in)
src/worker/boardroom/boarddb.ts # M: columns table +tone/icon; seed(snapshot,…); snapshot() new meta+columns
src/worker/boardroom/boardroom.ts # M: fetch reads x-template-json
src/client/api.ts               # M: listTemplates/createTemplate/updateTemplate/deleteTemplate
src/client/board/reducer.ts     # M: meta reshape → state.templateName + state.glyph
src/client/board/BoardView.tsx  # M: header glyph/title from state.glyph/templateName
src/client/board/Column.tsx     # M: glyph from col.tone/col.icon
src/client/boards/BoardCard.tsx # M: glyph/name from board JSON
src/client/boards/CreateBoardModal.tsx # M: dynamic template options + Manage link
src/client/templates/reducer.ts # C: pure templateReducer
src/client/templates/TemplateBuilder.tsx # C: builder modal
src/client/templates/TemplatesPage.tsx    # C: /templates page
src/client/App.tsx              # M: /templates route
src/client/ui/Glyph.tsx         # M: Tone from shared
src/client/ui/icons.tsx         # M: Icon safe fallback for unknown names
src/client/ui/glyphs.ts         # M: drop columnGlyph/templateGlyph; keep templateName
test/worker/*, test/client/*    # M/C per task
```

---

## Task 1: Data-driven columns & glyphs (reshape; no new feature)

Reshape the column/glyph pipeline so columns carry `tone`/`icon` and the board snapshot carries `templateName`/`glyph`, flowing built-in → DO → init → reducer → board view. **Behavior is unchanged** (built-ins render exactly as before); the suite stays green. This is the atomic foundation; it can't be split without breaking the TS build.

**Files:**
- Modify: `src/shared/protocol.ts`, `src/shared/templates.ts`, `src/worker/boardroom/boarddb.ts`, `src/worker/boardroom/boardroom.ts`, `src/worker/ws.ts`, `src/client/board/reducer.ts`, `src/client/board/BoardView.tsx`, `src/client/board/Column.tsx`, `src/client/boards/BoardCard.tsx`, `src/client/ui/Glyph.tsx`, `src/client/ui/icons.tsx`, `src/client/ui/glyphs.ts`
- Test (update): `test/worker/templates.test.ts`, `test/worker/boardroom.handlers.test.ts`, `test/worker/boardroom.ws.test.ts`, `test/client/reducer.test.ts`

**Interfaces:**
- Produces: the canonical reshaped types above; `BoardDb.seed(snapshot: TemplateSnapshot, maxVotes: number, ownerId: string)`; `BoardDb.snapshot(userId)` returns the new `BoardSnapshot`; reducer `BoardState` gains `templateName: string` + `glyph: {tone,icon}` (replaces `template`).

- [ ] **Step 1: Reshape `protocol.ts` and `templates.ts`**

In `src/shared/protocol.ts`: add `Tone`, reshape `ColumnDef` (+`tone`/`icon`), add `TemplateSnapshot`, `TemplateColumnInput`, `TemplateSummary`, reshape `BoardSnapshot.meta`, extend `LIMITS`, add `DEFAULT_COLUMN_ICON` — exactly as in the "Canonical reshaped types" section above.

In `src/shared/templates.ts` replace the body with the `TemplateSnapshot`-shaped map (tone/icon copied from the current `ui/glyphs.ts` maps):
```ts
import type { TemplateId, TemplateSnapshot } from './protocol';

export const TEMPLATES: Record<TemplateId, TemplateSnapshot> = {
  three_little_pigs: {
    name: 'Three Little Pigs',
    glyph: { tone: 'coral', icon: 'home' },
    columns: [
      { id: 'straws', title: 'House of Straws', subtitle: 'Things that could easily fall apart', tone: 'amber', icon: 'wind' },
      { id: 'sticks', title: 'House of Sticks', subtitle: 'Things that are working but could be improved', tone: 'green', icon: 'layers' },
      { id: 'bricks', title: 'House of Bricks', subtitle: 'Things that are strong and stable', tone: 'coral', icon: 'home' },
    ],
  },
  sailboat: {
    name: 'Sailboat',
    glyph: { tone: 'blue', icon: 'sail' },
    columns: [
      { id: 'wind', title: 'Wind', subtitle: 'What is pushing us forward', tone: 'blue', icon: 'wind' },
      { id: 'anchors', title: 'Anchors', subtitle: 'What is holding us back', tone: 'slate', icon: 'anchor' },
      { id: 'rocks', title: 'Rocks', subtitle: 'Risks ahead of us', tone: 'purple', icon: 'mountain' },
      { id: 'island', title: 'Island', subtitle: 'Our goals and ideal destination', tone: 'green', icon: 'palm' },
    ],
  },
};
```

- [ ] **Step 2: Update the templates worker test (RED)**

In `test/worker/templates.test.ts` add an assertion that columns now carry tone/icon:
```ts
it('columns carry a tone and icon', () => {
  const c = TEMPLATES.sailboat.columns[1];
  expect(c.id).toBe('anchors');
  expect(c.tone).toBe('slate');
  expect(typeof c.icon).toBe('string');
});
it('templates carry a representative glyph', () => {
  expect(TEMPLATES.sailboat.glyph).toEqual({ tone: 'blue', icon: 'sail' });
});
```
Run `bun run test -- templates` → FAIL before the Step 1 edits land / PASS after.

- [ ] **Step 3: Reshape the DO (`boarddb.ts`)**

`columns` table gains `tone TEXT, icon TEXT`. `meta` gains `template_name TEXT, glyph_tone TEXT, glyph_icon TEXT` (drop the `template` column). `seed` takes a snapshot:
```ts
import type { BoardSnapshot, Card, ColumnDef, TemplateSnapshot } from '../../shared/protocol';

// in init(): columns table now
//   CREATE TABLE IF NOT EXISTS columns (id TEXT PRIMARY KEY, title TEXT, subtitle TEXT, position INTEGER, tone TEXT, icon TEXT);
// meta now
//   CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY CHECK (id=1), template_name TEXT, max_votes INTEGER, owner_id TEXT, glyph_tone TEXT, glyph_icon TEXT, seeded INTEGER DEFAULT 0);

seed(snapshot: TemplateSnapshot, maxVotes: number, ownerId: string): void {
  const row = this.sql.exec('SELECT seeded FROM meta WHERE id=1').toArray()[0] as { seeded: number } | undefined;
  if (row?.seeded === 1) return;
  this.sql.exec(
    'INSERT OR REPLACE INTO meta (id,template_name,max_votes,owner_id,glyph_tone,glyph_icon,seeded) VALUES (1,?,?,?,?,?,1)',
    snapshot.name, maxVotes, ownerId, snapshot.glyph.tone, snapshot.glyph.icon,
  );
  snapshot.columns.forEach((col, i) => {
    this.sql.exec('INSERT OR IGNORE INTO columns (id,title,subtitle,position,tone,icon) VALUES (?,?,?,?,?,?)',
      col.id, col.title, col.subtitle, i, col.tone, col.icon);
  });
}

getMeta(): { templateName: string; maxVotes: number; ownerId: string; glyph: { tone: string; icon: string } } {
  const m = this.sql.exec('SELECT template_name,max_votes,owner_id,glyph_tone,glyph_icon FROM meta WHERE id=1').one() as any;
  return { templateName: m.template_name, maxVotes: m.max_votes, ownerId: m.owner_id, glyph: { tone: m.glyph_tone, icon: m.glyph_icon } };
}
```
`setMaxVotes` unchanged. `snapshot(userId)` returns the new meta + columns with tone/icon:
```ts
snapshot(userId: string): BoardSnapshot {
  const m = this.getMeta();
  const columns = (this.sql.exec('SELECT id,title,subtitle,tone,icon FROM columns ORDER BY position').toArray() as any[])
    .map((r): ColumnDef => ({ id: r.id, title: r.title, subtitle: r.subtitle, tone: r.tone, icon: r.icon }));
  const cards = (this.sql.exec(`SELECT c.id,c.column_id,c.text,c.author_id,c.author_name,c.position,c.created_at,
      COALESCE((SELECT SUM(count) FROM votes v WHERE v.card_id=c.id),0) AS votes
    FROM cards c ORDER BY c.position, c.created_at, c.id`).toArray() as any[])
    .map((r): Card => ({ id: r.id, columnId: r.column_id, text: r.text, authorId: r.author_id, authorName: r.author_name, position: r.position, createdAt: r.created_at, votes: Number(r.votes) }));
  const yourVotes: Record<string, number> = {};
  for (const r of this.sql.exec('SELECT card_id,count FROM votes WHERE user_id=?', userId).toArray() as any[]) yourVotes[r.card_id] = r.count;
  return { meta: { templateName: m.templateName, maxVotes: Number(m.maxVotes), ownerId: m.ownerId, glyph: { tone: m.glyph.tone as any, icon: m.glyph.icon } }, columns, cards, yourVotes };
}
```
Keep the existing `addCard/getCard/columnExists/editCard/deleteCard/voteAtomic/unvote/voteTotal/userVoteCount/moveCard/renormalize/setMaxVotes` unchanged.

- [ ] **Step 4: DO `fetch` reads `x-template-json` (`boardroom.ts`)**

Replace the seed call in `fetch`:
```ts
const snapshot = JSON.parse(request.headers.get('x-template-json')!) as import('../../shared/protocol').TemplateSnapshot;
this.db.seed(snapshot, Number(request.headers.get('x-max-votes')), request.headers.get('x-user-id')!);
```
(`x-user-id` is the connecting user, but `seed` stores `ownerId` — the Worker passes the board owner; keep using `x-owner-id`: `this.db.seed(snapshot, Number(request.headers.get('x-max-votes')), request.headers.get('x-owner-id')!)`.) Drop the `x-template` read.

- [ ] **Step 5: `ws.ts` resolves and passes `x-template-json`**

After loading the board row, resolve its snapshot and pass it:
```ts
import { TEMPLATES } from '../shared/templates';
import type { TemplateSnapshot } from '../shared/protocol';

const snapshot: TemplateSnapshot = board.template_snapshot
  ? JSON.parse(board.template_snapshot)
  : TEMPLATES[board.template as keyof typeof TEMPLATES];
// forwarded headers: replace x-template with
//   'x-template-json': JSON.stringify(snapshot),
// keep x-max-votes / x-owner-id / x-board-id / x-user-id / x-display-name
```
(`board.template_snapshot` is null for existing boards → falls back to the built-in by `board.template`. The `BoardRow` type in `boards/repo.ts` gains `template_snapshot: string | null` — add it in Task 5; for Task 1 it isn't selected yet, so read it defensively as `(board as any).template_snapshot`. Replace with the typed field in Task 5.)

- [ ] **Step 6: Reshape the reducer (`reducer.ts`)**

`BoardState` replaces `template: TemplateId | null` with `templateName: string` + `glyph: { tone: Tone; icon: string }`; `fromSnapshot` maps the new meta:
```ts
export interface BoardState {
  ready: boolean;
  templateName: string;
  glyph: { tone: Tone; icon: string };
  maxVotes: number;
  ownerId: string;
  columns: ColumnDef[];
  cards: Record<string, Card>;
  order: Record<string, string[]>;
  yourVotes: Record<string, number>;
}
export const initialState: BoardState = { ready: false, templateName: '', glyph: { tone: 'slate', icon: 'layers' }, maxVotes: 0, ownerId: '', columns: [], cards: {}, order: {}, yourVotes: {} };
// in fromSnapshot: templateName: s.meta.templateName, glyph: s.meta.glyph, maxVotes: s.meta.maxVotes, ownerId: s.meta.ownerId
```
All other folds unchanged.

- [ ] **Step 7: Update board view, Column, BoardCard, ui**

`BoardView.tsx`: header reads `state.glyph` + `state.templateName` (drop `templateGlyph`/`state.template`):
```tsx
<Glyph tone={state.glyph.tone} icon={state.glyph.icon as IconName} size={30} />
…<h1>{state.templateName}</h1>
```
`Column.tsx`: glyph from the column itself (drop `columnGlyph`):
```tsx
<Glyph tone={col.tone} icon={col.icon as IconName} size={28} />
```
`ui/Glyph.tsx`: `import type { Tone } from '../../shared/protocol'` and re-export (`export type { Tone }`); remove the local `Tone` definition.
`ui/icons.tsx`: make `Icon` tolerate unknown names — `{PATHS[name as IconName] ?? PATHS[DEFAULT_GLYPH_ICON_FALLBACK ?? 'layers']}`; simplest: `const node = (PATHS as Record<string, ReactNode>)[name] ?? PATHS.layers;` and render `node`. Loosen the prop to `name: string`.
`ui/glyphs.ts`: delete `columnGlyph` and `templateGlyph`; keep `templateName(template)` (reads `TEMPLATES[id]?.name` with title-case fallback). `BoardCard.tsx` keeps using `templateName(board.template)` for now and a temporary glyph from `TEMPLATES[board.template]?.glyph ?? { tone:'slate', icon:'layers' }` (Task 5 switches it to server-resolved `board.glyph`).

- [ ] **Step 8: Update affected worker + client tests**

`test/worker/boardroom.handlers.test.ts`: every `i.db.seed('sailboat', 6, 'owner')` becomes `i.db.seed(TEMPLATES.sailboat, 6, 'owner')` (import `TEMPLATES`); `i.db.seed('three_little_pigs', 3, 'owner')` → `i.db.seed(TEMPLATES.three_little_pigs, 3, 'owner')`. Snapshot assertions that read `snap.meta` (`{template, maxVotes, ownerId}`) become `snap.meta.templateName` (e.g. `expect(snap.meta.templateName).toBe('Sailboat')`) + `snap.meta.maxVotes`/`ownerId`/`glyph`. Column assertions still check ids; optionally assert `snap.columns[0].tone`.
`test/worker/boardroom.ws.test.ts`: the `init` snapshot now has `meta.templateName` and `columns[i].tone`; keep the `columns.length` assertion; the board created via the API still seeds (Task 5 stores the snapshot; until then the ws-test board falls back to built-in by `board.template`).
`test/client/reducer.test.ts`: the `snap` fixture's `meta` becomes `{ templateName: 'Three Little Pigs', maxVotes: 3, ownerId: 'o', glyph: { tone: 'coral', icon: 'home' } }`; any assertion on `state.template` becomes `state.templateName`.

- [ ] **Step 9: Run the full suite + typecheck + build, then commit**

```bash
bun run typecheck && bun run test && bun run test:ws && bun run test:client && bun run build
```
Expected: all green (worker, ws, client), tsc clean, build OK. Behavior identical to before.
```bash
git add -A && git commit -m "refactor: data-driven column tone/icon + templateName/glyph through the board pipeline"
```

---

## Task 2: D1 templates table + boards.template_snapshot

**Files:**
- Modify: `src/worker/db/schema.sql`
- Test: `test/worker/schema.test.ts` (append)

**Interfaces:**
- Produces: D1 `templates(id,owner_id,name,columns_json,created_at,updated_at)` + index; `boards.template_snapshot TEXT` (nullable).

- [ ] **Step 1: Add to `schema.sql`**

Add the `template_snapshot TEXT` column to the existing `boards` `CREATE TABLE` statement (so fresh DBs include it), and append the templates table:
```sql
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL,
  columns_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_templates_owner ON templates (owner_id);
```
> For an already-existing DB (which `CREATE TABLE IF NOT EXISTS` won't alter), a one-time `ALTER TABLE boards ADD COLUMN template_snapshot TEXT;` is needed. The test/local DBs are recreated, so the CREATE addition suffices there; document the ALTER in the README deploy section in the final task.

- [ ] **Step 2: Write the failing test**

```ts
// test/worker/schema.test.ts (append)
it('templates table exists', async () => {
  const r = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='templates'").first();
  expect(r?.name).toBe('templates');
});
it('boards has template_snapshot column', async () => {
  const cols = await env.DB.prepare('PRAGMA table_info(boards)').all<{ name: string }>();
  expect(cols.results.map((c) => c.name)).toContain('template_snapshot');
});
```

- [ ] **Step 3: Apply schema to the test/local D1 and run**

The `worker` project's `setup-d1.ts` applies `schema.sql` to a fresh D1 per file, so the new column/table appear automatically. Run `bun run test -- schema` → PASS. (If iterating against a persisted local D1, recreate it: delete `.wrangler/state` D1 or run the ALTER.)

- [ ] **Step 4: Commit**

```bash
git add src/worker/db/schema.sql test/worker/schema.test.ts && git commit -m "feat: D1 templates table + boards.template_snapshot column"
```

---

## Task 3: Templates repo (D1 CRUD)

**Files:**
- Create: `src/worker/templates/repo.ts`
- Test: `test/worker/templates_repo.test.ts`

**Interfaces:**
- Produces:
  - `interface TemplateRow { id; owner_id; name; columns_json; created_at; updated_at }`
  - `createTemplate(env, ownerId, name, columns: TemplateColumnInput[]): Promise<TemplateSummary>`
  - `listTemplates(env, ownerId): Promise<TemplateSummary[]>`
  - `getTemplate(env, id): Promise<TemplateRow | null>`
  - `updateTemplate(env, id, ownerId, name, columns): Promise<boolean>` (true if a row owned by ownerId was updated)
  - `deleteTemplate(env, id, ownerId): Promise<boolean>`
  - `toSummary(row: TemplateRow): TemplateSummary` (parses columns_json, assigns `DEFAULT_COLUMN_ICON`, `readOnly:false`)

- [ ] **Step 1: Write failing tests**

```ts
// test/worker/templates_repo.test.ts
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import * as repo from '../../src/worker/templates/repo';

beforeEach(async () => { await env.DB.exec('DELETE FROM templates'); });

const cols = [
  { title: 'Loved', subtitle: 'what went great', tone: 'green' as const },
  { title: 'Lacked', subtitle: 'what was missing', tone: 'coral' as const },
];

describe('templates repo', () => {
  it('creates and lists owner templates with parsed columns + default icon', async () => {
    const t = await repo.createTemplate(env, 'u1', 'My Retro', cols);
    expect(t.name).toBe('My Retro');
    expect(t.readOnly).toBe(false);
    expect(t.columns).toHaveLength(2);
    expect(t.columns[0]).toMatchObject({ title: 'Loved', tone: 'green', icon: 'layers' });
    expect(t.columns[0].id).toBeTruthy();
    const list = await repo.listTemplates(env, 'u1');
    expect(list.map((x) => x.id)).toContain(t.id);
    expect(await repo.listTemplates(env, 'other')).toHaveLength(0);
  });

  it('update/delete are owner-scoped', async () => {
    const t = await repo.createTemplate(env, 'u1', 'Mine', cols);
    expect(await repo.updateTemplate(env, t.id, 'intruder', 'Hacked', cols)).toBe(false);
    expect(await repo.updateTemplate(env, t.id, 'u1', 'Renamed', cols)).toBe(true);
    expect((await repo.getTemplate(env, t.id))!.name).toBe('Renamed');
    expect(await repo.deleteTemplate(env, t.id, 'intruder')).toBe(false);
    expect(await repo.deleteTemplate(env, t.id, 'u1')).toBe(true);
    expect(await repo.getTemplate(env, t.id)).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL** (`bun run test -- templates_repo`, module missing).

- [ ] **Step 3: Implement `repo.ts`**

```ts
import type { Env } from '../types';
import { DEFAULT_COLUMN_ICON, type TemplateColumnInput, type TemplateSummary, type ColumnDef, type Tone } from '../../shared/protocol';

export interface TemplateRow { id: string; owner_id: string; name: string; columns_json: string; created_at: number; updated_at: number; }

export function toSummary(row: TemplateRow): TemplateSummary {
  const raw = JSON.parse(row.columns_json) as { id: string; title: string; subtitle: string; tone: Tone }[];
  const columns: ColumnDef[] = raw.map((c) => ({ id: c.id, title: c.title, subtitle: c.subtitle, tone: c.tone, icon: DEFAULT_COLUMN_ICON }));
  return { id: row.id, name: row.name, glyph: { tone: columns[0]?.tone ?? 'slate', icon: DEFAULT_COLUMN_ICON }, columns, readOnly: false };
}

function pack(columns: TemplateColumnInput[]): string {
  return JSON.stringify(columns.map((c) => ({ id: crypto.randomUUID(), title: c.title.trim(), subtitle: c.subtitle.trim(), tone: c.tone })));
}

export async function createTemplate(env: Env, ownerId: string, name: string, columns: TemplateColumnInput[]): Promise<TemplateSummary> {
  const id = crypto.randomUUID(); const now = Date.now();
  await env.DB.prepare('INSERT INTO templates (id,owner_id,name,columns_json,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .bind(id, ownerId, name.trim(), pack(columns), now, now).run();
  return toSummary({ id, owner_id: ownerId, name: name.trim(), columns_json: pack(columns), created_at: now, updated_at: now } as TemplateRow);
}

export async function listTemplates(env: Env, ownerId: string): Promise<TemplateSummary[]> {
  const { results } = await env.DB.prepare('SELECT * FROM templates WHERE owner_id=? ORDER BY created_at DESC').bind(ownerId).all<TemplateRow>();
  return results.map(toSummary);
}

export async function getTemplate(env: Env, id: string): Promise<TemplateRow | null> {
  return env.DB.prepare('SELECT * FROM templates WHERE id=?').bind(id).first<TemplateRow>();
}

export async function updateTemplate(env: Env, id: string, ownerId: string, name: string, columns: TemplateColumnInput[]): Promise<boolean> {
  const res = await env.DB.prepare('UPDATE templates SET name=?, columns_json=?, updated_at=? WHERE id=? AND owner_id=?')
    .bind(name.trim(), pack(columns), Date.now(), id, ownerId).run();
  return (res.meta.changes ?? 0) > 0;
}

export async function deleteTemplate(env: Env, id: string, ownerId: string): Promise<boolean> {
  const res = await env.DB.prepare('DELETE FROM templates WHERE id=? AND owner_id=?').bind(id, ownerId).run();
  return (res.meta.changes ?? 0) > 0;
}
```
> Note: `pack(columns)` regenerates column ids each call. In `updateTemplate` that re-ids columns on every save — acceptable (boards hold snapshots, not live refs). `createTemplate` calls `pack` twice (insert + summary); to avoid two different id sets, compute `const packed = pack(columns)` once and reuse for both the insert and `toSummary({...,columns_json: packed})`. Fix this in implementation.

- [ ] **Step 4: Run → PASS + commit**

```bash
git add src/worker/templates/repo.ts test/worker/templates_repo.test.ts && git commit -m "feat: templates D1 repo (owner-scoped CRUD)"
```

---

## Task 4: Templates routes + validation

**Files:**
- Create: `src/worker/templates/validate.ts`, `src/worker/templates/routes.ts`
- Modify: `src/worker/index.ts` (mount `/api/templates`)
- Test: `test/worker/templates_api.test.ts`

**Interfaces:**
- Consumes: `repo.*` (Task 3), `requireSession` (existing), `LIMITS`/`Tone` (Task 1).
- Produces: `validateTemplate(body): { name: string; columns: TemplateColumnInput[] } | { error: string }`; routes `GET/POST /api/templates`, `PUT/DELETE /api/templates/:id`. GET returns `{ builtins: TemplateSummary[]; custom: TemplateSummary[] }`.

- [ ] **Step 1: Write failing tests**

```ts
// test/worker/templates_api.test.ts
import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { issueToken } from '../../src/worker/auth/tokens';

async function login(email: string) {
  const raw = await issueToken(env, email);
  const res = await SELF.fetch(`http://localhost:8788/api/auth/verify?token=${encodeURIComponent(raw)}`, { redirect: 'manual' });
  return res.headers.get('set-cookie')!.split(';')[0];
}
const H = (cookie: string) => ({ cookie, origin: 'http://localhost:8788', 'content-type': 'application/json' });
beforeEach(async () => { for (const t of ['templates','sessions','users','magic_tokens']) await env.DB.exec(`DELETE FROM ${t}`); });

describe('/api/templates', () => {
  it('GET returns built-ins + the caller’s custom templates', async () => {
    const cookie = await login('t@x.com');
    const created = await (await SELF.fetch('http://localhost:8788/api/templates', { method: 'POST', headers: H(cookie),
      body: JSON.stringify({ name: 'Mine', columns: [{ title: 'A', subtitle: '', tone: 'green' }] }) })).json<any>();
    const list = await (await SELF.fetch('http://localhost:8788/api/templates', { headers: H(cookie) })).json<any>();
    expect(list.builtins.map((t: any) => t.id)).toContain('sailboat');
    expect(list.builtins.every((t: any) => t.readOnly)).toBe(true);
    expect(list.custom.map((t: any) => t.id)).toContain(created.id);
  });

  it('rejects invalid input (no columns / bad tone / too many)', async () => {
    const cookie = await login('t@x.com');
    const bad = await SELF.fetch('http://localhost:8788/api/templates', { method: 'POST', headers: H(cookie),
      body: JSON.stringify({ name: '', columns: [] }) });
    expect(bad.status).toBe(400);
  });

  it('PUT/DELETE are owner-scoped (404 for non-owner)', async () => {
    const owner = await login('o@x.com');
    const t = await (await SELF.fetch('http://localhost:8788/api/templates', { method: 'POST', headers: H(owner),
      body: JSON.stringify({ name: 'Mine', columns: [{ title: 'A', subtitle: '', tone: 'green' }] }) })).json<any>();
    const other = await login('g@x.com');
    const put = await SELF.fetch(`http://localhost:8788/api/templates/${t.id}`, { method: 'PUT', headers: H(other),
      body: JSON.stringify({ name: 'X', columns: [{ title: 'A', subtitle: '', tone: 'green' }] }) });
    expect(put.status).toBe(404);
    const del = await SELF.fetch(`http://localhost:8788/api/templates/${t.id}`, { method: 'DELETE', headers: H(other) });
    expect(del.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run → FAIL**.

- [ ] **Step 3: Implement `validate.ts`, `routes.ts`, mount**

```ts
// src/worker/templates/validate.ts
import { LIMITS, type TemplateColumnInput, type Tone } from '../../shared/protocol';
const TONES: Tone[] = ['green','blue','coral','purple','amber','pink','slate'];

export function validateTemplate(body: any): { name: string; columns: TemplateColumnInput[] } | { error: string } {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > LIMITS.templateName) return { error: 'bad_name' };
  const raw = Array.isArray(body?.columns) ? body.columns : [];
  if (raw.length < 1 || raw.length > LIMITS.templateColumnsMax) return { error: 'bad_columns' };
  const columns: TemplateColumnInput[] = [];
  for (const c of raw) {
    const title = typeof c?.title === 'string' ? c.title.trim() : '';
    const subtitle = typeof c?.subtitle === 'string' ? c.subtitle.trim() : '';
    if (!title || title.length > LIMITS.columnTitle) return { error: 'bad_column_title' };
    if (subtitle.length > LIMITS.columnSubtitle) return { error: 'bad_column_subtitle' };
    if (!TONES.includes(c?.tone)) return { error: 'bad_tone' };
    columns.push({ title, subtitle, tone: c.tone });
  }
  return { name, columns };
}
```
```ts
// src/worker/templates/routes.ts
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSession } from '../auth/middleware';
import { TEMPLATES } from '../../shared/templates';
import type { TemplateSummary } from '../../shared/protocol';
import * as repo from './repo';
import { validateTemplate } from './validate';

type Vars = { Variables: { userId: string }; Bindings: Env };
export const templateRoutes = new Hono<Vars>();
templateRoutes.use('*', requireSession);

const builtins = (): TemplateSummary[] =>
  Object.entries(TEMPLATES).map(([id, t]) => ({ id, name: t.name, glyph: t.glyph, columns: t.columns, readOnly: true }));

templateRoutes.get('/', async (c) => c.json({ builtins: builtins(), custom: await repo.listTemplates(c.env, c.get('userId')) }));

templateRoutes.post('/', async (c) => {
  const v = validateTemplate(await c.req.json().catch(() => ({})));
  if ('error' in v) return c.json(v, 400);
  return c.json(await repo.createTemplate(c.env, c.get('userId'), v.name, v.columns));
});

templateRoutes.put('/:id', async (c) => {
  const v = validateTemplate(await c.req.json().catch(() => ({})));
  if ('error' in v) return c.json(v, 400);
  const ok = await repo.updateTemplate(c.env, c.req.param('id'), c.get('userId'), v.name, v.columns);
  return ok ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
});

templateRoutes.delete('/:id', async (c) => {
  const ok = await repo.deleteTemplate(c.env, c.req.param('id'), c.get('userId'));
  return ok ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
});
```
Mount in `src/worker/index.ts`: `app.route('/api/templates', templateRoutes);` (after `/api/boards`, both behind the `/api/*` origin guard).

- [ ] **Step 4: Run → PASS, full suite green, commit**

```bash
bun run test && git add src/worker/templates src/worker/index.ts test/worker/templates_api.test.ts && git commit -m "feat: /api/templates CRUD routes + validation"
```

---

## Task 5: Board create from any template (snapshot) + resolved board JSON

**Files:**
- Modify: `src/worker/boards/repo.ts`, `src/worker/boards/routes.ts`, `src/worker/ws.ts`, `src/client/boards/BoardCard.tsx`, `src/client/boards/BoardList.tsx`
- Test: `test/worker/boards.test.ts` (append)

**Interfaces:**
- Consumes: `repo.getTemplate` (Task 3), `TEMPLATES`, `DEFAULT_COLUMN_ICON`, `TemplateSnapshot`.
- Produces: `createBoard` stores `template_snapshot`; `BoardRow` gains `template_snapshot: string | null`; board JSON gains `templateName: string` + `glyph: {tone,icon}`; a `resolveSnapshot(env, ownerId, templateRef)` helper returning `TemplateSnapshot | null`.

- [ ] **Step 1: Write failing tests**

```ts
// test/worker/boards.test.ts (append; reuse the file's login() + beforeEach)
it('creates a board from a custom template and snapshots its columns', async () => {
  const cookie = await login('o@x.com');
  const tpl = await (await SELF.fetch('http://localhost:8788/api/templates', { method: 'POST',
    headers: { cookie, origin: 'http://localhost:8788', 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Start/Stop', columns: [
      { title: 'Start', subtitle: '', tone: 'green' }, { title: 'Stop', subtitle: '', tone: 'coral' }] }) })).json<{ id: string }>();
  const board = await (await SELF.fetch('http://localhost:8788/api/boards', { method: 'POST',
    headers: { cookie, origin: 'http://localhost:8788', 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Sprint', template: tpl.id, maxVotes: 5 }) })).json<any>();
  expect(board.templateName).toBe('Start/Stop');
  expect(board.glyph).toMatchObject({ tone: 'green' });
  const row = await env.DB.prepare('SELECT template_snapshot FROM boards WHERE id=?').bind(board.id).first<{ template_snapshot: string }>();
  const snap = JSON.parse(row!.template_snapshot);
  expect(snap.columns.map((c: any) => c.title)).toEqual(['Start', 'Stop']);
});

it('rejects a board referencing someone else’s template', async () => {
  const owner = await login('o@x.com');
  const tpl = await (await SELF.fetch('http://localhost:8788/api/templates', { method: 'POST',
    headers: { cookie: owner, origin: 'http://localhost:8788', 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Mine', columns: [{ title: 'A', subtitle: '', tone: 'green' }] }) })).json<{ id: string }>();
  const other = await login('g@x.com');
  const res = await SELF.fetch('http://localhost:8788/api/boards', { method: 'POST',
    headers: { cookie: other, origin: 'http://localhost:8788', 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'X', template: tpl.id, maxVotes: 5 }) });
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: Run → FAIL**.

- [ ] **Step 3: Implement**

`boards/repo.ts`: `BoardRow` gains `template_snapshot: string | null`. `createBoard` takes the snapshot and stores it:
```ts
export interface BoardRow { id: string; name: string; owner_id: string; template: string; max_votes: number; created_at: number; template_snapshot: string | null; }

export async function createBoard(env: Env, ownerId: string, name: string, templateRef: string, snapshot: TemplateSnapshot, maxVotes: number): Promise<BoardRow> {
  const id = crypto.randomUUID(); const now = Date.now(); const snapJson = JSON.stringify(snapshot);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO boards (id,name,owner_id,template,max_votes,created_at,template_snapshot) VALUES (?,?,?,?,?,?,?)')
      .bind(id, name, ownerId, templateRef, maxVotes, now, snapJson),
    env.DB.prepare('INSERT INTO board_members (board_id,user_id,role,joined_at) VALUES (?,?,?,?)').bind(id, ownerId, 'owner', now),
  ]);
  return { id, name, owner_id: ownerId, template: templateRef, max_votes: maxVotes, created_at: now, template_snapshot: snapJson };
}

// resolve a board's snapshot (new boards have it; old ones fall back to a built-in)
export function boardSnapshot(board: BoardRow): TemplateSnapshot | null {
  if (board.template_snapshot) return JSON.parse(board.template_snapshot) as TemplateSnapshot;
  return (TEMPLATES as Record<string, TemplateSnapshot>)[board.template] ?? null;
}
```
`listBoardsForUser`/`getBoard` now `SELECT *` (already do) so `template_snapshot` is present.

`boards/routes.ts`: add a resolver + use it; `toJson` adds `templateName` + `glyph`:
```ts
import { TEMPLATES } from '../../shared/templates';
import { DEFAULT_COLUMN_ICON, type TemplateSnapshot } from '../../shared/protocol';
import * as templateRepo from '../templates/repo';

async function resolveSnapshot(env: Env, ownerId: string, ref: string): Promise<TemplateSnapshot | null> {
  if (ref in TEMPLATES) return (TEMPLATES as Record<string, TemplateSnapshot>)[ref];
  const row = await templateRepo.getTemplate(env, ref);
  if (!row || row.owner_id !== ownerId) return null;
  const s = templateRepo.toSummary(row);
  return { name: s.name, glyph: s.glyph, columns: s.columns };
}

const toJson = (b: repo.BoardRow & { role?: string }) => {
  const snap = repo.boardSnapshot(b);
  return { id: b.id, name: b.name, template: b.template, maxVotes: b.max_votes, ownerId: b.owner_id, createdAt: b.created_at, role: b.role,
    templateName: snap?.name ?? b.template, glyph: snap?.glyph ?? { tone: 'slate', icon: DEFAULT_COLUMN_ICON } };
};
```
In `POST /`, replace the `template in TEMPLATES` check with snapshot resolution:
```ts
const snapshot = await resolveSnapshot(c.env, c.get('userId'), template);
if (!snapshot) return c.json({ error: 'bad_template' }, 400);
…
const row = await repo.createBoard(c.env, c.get('userId'), template, snapshot, name, maxVotes);
return c.json(toJson({ ...row, role: 'owner' }));
```

`ws.ts`: use the typed field now — `const snapshot = boardSnapshot(board);` (import from boards/repo) and `JSON.stringify(snapshot)` into `x-template-json` (replacing the `(board as any)` from Task 1).

`BoardCard.tsx`: read `board.templateName` + `board.glyph` (server-resolved); drop the `TEMPLATES`/`templateName` fallback:
```tsx
export function BoardCard({ board, index = 0 }: { board: { id: string; name: string; templateName: string; glyph: { tone: Tone; icon: string } }; index?: number }) {
  return (<Link to={`/b/${board.id}`} className="board-card" style={{ animationDelay: `${index * 40}ms` }}>
    <Glyph tone={board.glyph.tone} icon={board.glyph.icon as IconName} size={36} />
    <h3>{board.name}</h3><div className="meta">{board.templateName}</div>
    <div className="preview" aria-hidden="true"><i /><i /><i /></div></Link>);
}
```
`BoardList.tsx`: the `BoardSummary` interface gains `templateName: string` + `glyph: { tone: Tone; icon: string }`.

- [ ] **Step 4: Run → PASS, full suite green, commit**

```bash
bun run test && bun run test:ws && bun run typecheck && git add -A && git commit -m "feat: create boards from custom templates with a column snapshot"
```

---

## Task 6: API client template wrappers

**Files:**
- Modify: `src/client/api.ts`
- Test: covered by component tests (Tasks 8–10).

**Interfaces:**
- Produces on `api`: `listTemplates()`, `createTemplate(input)`, `updateTemplate(id, input)`, `deleteTemplate(id)` where `input = { name: string; columns: TemplateColumnInput[] }`.

- [ ] **Step 1: Add the wrappers**

```ts
listTemplates: () => fetch('/api/templates').then(json),
createTemplate: (t: { name: string; columns: TemplateColumnInput[] }) => fetch('/api/templates', { method: 'POST', headers: h, body: JSON.stringify(t) }).then(json),
updateTemplate: (id: string, t: { name: string; columns: TemplateColumnInput[] }) => fetch(`/api/templates/${id}`, { method: 'PUT', headers: h, body: JSON.stringify(t) }).then(json),
deleteTemplate: (id: string) => fetch(`/api/templates/${id}`, { method: 'DELETE', headers: h }).then(json),
```

- [ ] **Step 2: Typecheck + commit**

```bash
bun run typecheck && git add src/client/api.ts && git commit -m "feat: template API client wrappers"
```

---

## Task 7: templateReducer (pure)

**Files:**
- Create: `src/client/templates/reducer.ts`
- Test: `test/client/template_reducer.test.ts`

**Interfaces:**
- Produces: `BuilderState { name: string; columns: { key: string; title: string; subtitle: string; tone: Tone }[] }`; `initialBuilder(): BuilderState`; `fromTemplate(t: TemplateSummary): BuilderState`; `templateReducer(state, action)` with actions `setName`, `addColumn`, `removeColumn{key}`, `moveColumn{key,dir:-1|1}`, `setField{key,field:'title'|'subtitle',value}`, `setTone{key,tone}`; `toInput(state): { name; columns: TemplateColumnInput[] }`. `key` is a stable client id (`crypto.randomUUID()`) for list rendering, distinct from server column ids.

- [ ] **Step 1: Write failing tests**

```ts
// test/client/template_reducer.test.ts
import { describe, it, expect } from 'vitest';
import { initialBuilder, templateReducer, toInput } from '../../src/client/templates/reducer';

it('adds, edits, tones, reorders, removes columns immutably', () => {
  let s = initialBuilder(); // starts with 1 empty column
  s = templateReducer(s, { type: 'setName', value: 'Retro' });
  s = templateReducer(s, { type: 'addColumn' });
  expect(s.columns).toHaveLength(2);
  const [k0, k1] = s.columns.map((c) => c.key);
  s = templateReducer(s, { type: 'setField', key: k0, field: 'title', value: 'Good' });
  s = templateReducer(s, { type: 'setTone', key: k0, tone: 'green' });
  s = templateReducer(s, { type: 'setField', key: k1, field: 'title', value: 'Bad' });
  s = templateReducer(s, { type: 'moveColumn', key: k1, dir: -1 });
  expect(s.columns.map((c) => c.title)).toEqual(['Bad', 'Good']);
  s = templateReducer(s, { type: 'removeColumn', key: k0 });
  expect(s.columns.map((c) => c.title)).toEqual(['Bad']);
  expect(toInput(s)).toEqual({ name: 'Retro', columns: [{ title: 'Bad', subtitle: '', tone: 'slate' }] });
});

it('does not remove the last column or reorder past the ends', () => {
  let s = initialBuilder();
  const k = s.columns[0].key;
  s = templateReducer(s, { type: 'removeColumn', key: k });
  expect(s.columns).toHaveLength(1); // floor of 1
  s = templateReducer(s, { type: 'moveColumn', key: k, dir: -1 });
  expect(s.columns).toHaveLength(1);
});
```

- [ ] **Step 2: Run → FAIL**.

- [ ] **Step 3: Implement `reducer.ts`** (pure, immutable; `addColumn` caps at `LIMITS.templateColumnsMax`, `removeColumn` floors at 1, `moveColumn` clamps). Default tone for a new column = `'slate'`. `fromTemplate` maps a `TemplateSummary`'s columns to rows with fresh `key`s. `toInput` strips keys → `{ title, subtitle, tone }[]`. (Full code: standard reducer switch with immutable array ops.)

- [ ] **Step 4: Run → PASS + commit**

```bash
bun run test:client -- template_reducer && git add src/client/templates/reducer.ts test/client/template_reducer.test.ts && git commit -m "feat: pure template-builder reducer"
```

---

## Task 8: Template builder modal

**Files:**
- Create: `src/client/templates/TemplateBuilder.tsx`
- Test: `test/client/components.test.tsx` (append)

**Interfaces:**
- Consumes: `templateReducer`, `toInput`, `fromTemplate`, `Glyph`, tone list.
- Produces: `TemplateBuilder({ initial?: TemplateSummary; onSave: (input) => Promise<void>; onClose: () => void })` — a `role="dialog"` modal (name field + column rows with a tone swatch group, title, subtitle, remove ×, ▲▼; "Add column"; Save/Cancel). Save calls `onSave(toInput(state))`; on reject keeps the modal open with an inline error.

- [ ] **Step 1: Write failing test**

```ts
import { TemplateBuilder } from '../../src/client/templates/TemplateBuilder';
it('builds a template and calls onSave with name + columns', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<TemplateBuilder onSave={onSave} onClose={() => {}} />);
  await userEvent.type(screen.getByLabelText(/template name/i), 'Quick Retro');
  await userEvent.type(screen.getAllByLabelText(/column title/i)[0], 'Keep');
  await userEvent.click(screen.getByRole('button', { name: /add column/i }));
  await userEvent.type(screen.getAllByLabelText(/column title/i)[1], 'Drop');
  await userEvent.click(screen.getByRole('button', { name: /save template/i }));
  expect(onSave).toHaveBeenCalledWith({ name: 'Quick Retro', columns: [
    { title: 'Keep', subtitle: '', tone: 'slate' }, { title: 'Drop', subtitle: '', tone: 'slate' }] });
});
```

- [ ] **Step 2: Run → FAIL**.

- [ ] **Step 3: Implement `TemplateBuilder.tsx`** — `useReducer(templateReducer, …)` seeded by `initial ? fromTemplate(initial) : initialBuilder()`; the overlay/modal markup mirrors `CreateBoardModal` (`.overlay`/`.modal`, `role="dialog"`). Each column row: a 7-button tone swatch group (each a `Glyph`-styled swatch with `aria-label` like `tone green`), a `<input aria-label="column title">`, a subtitle input, ▲▼ (disabled at ends), and × (disabled when 1 column). "Add column" disabled at the cap. Save: `try { await onSave(toInput(state)); onClose(); } catch { setError(true); }`. Add minimal CSS (`.swatch`, `.swatch[aria-pressed=true]`, `.col-row`) to `styles.css`.

- [ ] **Step 4: Run → PASS + commit**

```bash
bun run test:client -- components && git add src/client/templates/TemplateBuilder.tsx src/client/styles.css test/client/components.test.tsx && git commit -m "feat: template builder modal"
```

---

## Task 9: Templates page + route

**Files:**
- Create: `src/client/templates/TemplatesPage.tsx`
- Modify: `src/client/App.tsx`, `src/client/boards/BoardList.tsx` (topbar "Templates" link)
- Test: `test/client/components.test.tsx` (append)

**Interfaces:**
- Consumes: `api.listTemplates/createTemplate/updateTemplate/deleteTemplate`, `TemplateBuilder`, `Glyph`.
- Produces: `TemplatesPage` (top bar + Defaults section read-only + Your-templates section with Edit/Delete + New-template button opening the builder); `/templates` route (auth-guarded like `/`).

- [ ] **Step 1: Write failing test**

```ts
import { TemplatesPage } from '../../src/client/templates/TemplatesPage';
it('lists built-ins and custom templates and deletes a custom one', async () => {
  vi.spyOn(api, 'listTemplates').mockResolvedValue({
    builtins: [{ id: 'sailboat', name: 'Sailboat', glyph: { tone: 'blue', icon: 'sail' }, columns: [], readOnly: true }],
    custom: [{ id: 'c1', name: 'Mine', glyph: { tone: 'green', icon: 'layers' }, columns: [], readOnly: false }],
  } as any);
  const del = vi.spyOn(api, 'deleteTemplate').mockResolvedValue({ ok: true } as any);
  render(<MemoryRouter><TemplatesPage /></MemoryRouter>);
  expect(await screen.findByText('Sailboat')).toBeInTheDocument();
  expect(screen.getByText('Mine')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /delete mine/i }));
  expect(del).toHaveBeenCalledWith('c1');
});
```

- [ ] **Step 2: Run → FAIL**.

- [ ] **Step 3: Implement `TemplatesPage.tsx`**, mount `/templates` in `App.tsx` (`user ? <TemplatesPage/> : <Navigate to="/login"/>`), and add a "Templates" link/button to the `BoardList` top bar. Delete buttons use `aria-label={`delete ${t.name}`}`. New/Edit open `TemplateBuilder`; on save call `createTemplate`/`updateTemplate` then refetch.

- [ ] **Step 4: Run → PASS + build + commit**

```bash
bun run test:client && bun run build && git add -A && git commit -m "feat: templates page + /templates route"
```

---

## Task 10: Create-board modal — dynamic template options

**Files:**
- Modify: `src/client/boards/CreateBoardModal.tsx`
- Test: `test/client/components.test.tsx` (the existing create tests must still pass)

**Interfaces:**
- Consumes: `api.listTemplates`, static `TEMPLATES` (built-ins, synchronous), `templateGlyph`-equivalent from the option list.
- Produces: the Template `<select>` lists built-ins (always, synchronous) + fetched custom; a "Manage templates" `<Link>` to `/templates`.

- [ ] **Step 1: Update `CreateBoardModal`** — keep the labeled `<select id="b-tpl">` (test compat). Seed options synchronously from `Object.entries(TEMPLATES)` (built-ins); on mount `api.listTemplates().then(r => append r.custom)` and merge into the options list (dedupe by id). The selected glyph preview reads from the merged option's glyph (built-in static, or the fetched summary). Add `<Link to="/templates">Manage templates</Link>` under the select. `onCreate` still sends `{ name, template: selectedId, maxVotes }` (id is a built-in slug or custom uuid).

> The existing test renders `CreateBoardModal` without mocking `listTemplates` — built-ins must render synchronously so `selectOptions(getByLabelText(/template/i), 'sailboat')` resolves before the fetch settles. Guard the fetch with `.catch(() => {})` so a rejected/absent fetch leaves built-ins intact.

- [ ] **Step 2: Run the existing create tests + the suite → PASS** (`bun run test:client`), `bun run build`.

- [ ] **Step 3: Commit**

```bash
git add src/client/boards/CreateBoardModal.tsx test/client/components.test.tsx && git commit -m "feat: create-board modal lists custom templates"
```

---

## Task 11: E2E + README note

**Files:**
- Create: `e2e/templates.spec.ts`
- Modify: `README.md` (note the `template_snapshot` ALTER for existing DBs)
- Test: Playwright.

**Interfaces:** runs against `wrangler dev` (the existing `playwright.config.ts` webServer).

- [ ] **Step 1: Write `e2e/templates.spec.ts`** — log in (devUrl), go to `/templates`, create a template (name + 2 columns + pick tones), then create a board selecting that template, assert the board shows those column titles; then edit the template (rename a column) and assert the existing board is unchanged (snapshot); delete the template and assert the board still loads.

- [ ] **Step 2: Run `bun run e2e`** → PASS. (Install chromium first if needed: `bunx playwright install chromium`.)

- [ ] **Step 3: README** — under Deployment, add: existing deployed DBs need a one-time `wrangler d1 execute open-retro --remote --command "ALTER TABLE boards ADD COLUMN template_snapshot TEXT"` (fresh deploys get it from `schema.sql`).

- [ ] **Step 4: Commit**

```bash
git add e2e/templates.spec.ts README.md && git commit -m "test: templates E2E + deploy note for template_snapshot"
```

---

## Self-Review (completed)

**1. Spec coverage:** §3 data model → Tasks 1 (types/built-ins/protocol), 2 (D1). §4 worker → 3 (repo), 4 (routes/validation), 5 (board create + DO seed via Task 1's `x-template-json` + Task 5's snapshot). §5 frontend → 6 (api), 7 (reducer), 8 (builder), 9 (page/route), 10 (create modal), plus Task 1 (board-view glyphs from columns/meta). §6 testing → each task's tests + Task 11 E2E. Back-compat (null snapshot → built-in) → Task 1 (ws.ts fallback) + Task 5 (`boardSnapshot`). LIMITS additions → Task 1. Owner-scoping → Tasks 3/4/5.

**2. Placeholder scan:** Tasks 7/8/9/10 describe two implementations in prose rather than full code ("standard reducer switch", "mirrors CreateBoardModal", "implement TemplatesPage") — these are component/reducer bodies whose exact tests + interfaces are given; the implementer writes the component to satisfy the named test + interface. Acceptable for UI components with a concrete failing test; the *tests* and *interfaces* are fully specified. No "TBD/handle errors" placeholders elsewhere.

**3. Type consistency:** `TemplateSnapshot`/`TemplateSummary`/`TemplateColumnInput`/`ColumnDef`(+tone/icon)/`BoardSnapshot.meta`/`BoardState`(templateName,glyph) used consistently across tasks. `BoardDb.seed(snapshot, maxVotes, ownerId)` consistent between Task 1 (def + handler-test updates) and the DO fetch. `resolveSnapshot`/`boardSnapshot` names consistent in Task 5. Board JSON `templateName`+`glyph` consistent between Task 5 (worker) and BoardCard/BoardList.

**Version-dependent note (not a placeholder):** the worker tests use `SELF` from `cloudflare:test` (consistent with the existing suite); keep whatever surface the installed pool exposes.
