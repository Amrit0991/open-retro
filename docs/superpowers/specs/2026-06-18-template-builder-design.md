# Template Builder — Design Spec

**Date:** 2026-06-18
**Status:** Awaiting user review
**Builds on:** the shipped open-retro app (Vite SPA + Worker + per-board SQLite Durable Object + D1).

Let users create, edit, and delete their own retro **templates** (a named set of columns), instead of being limited to the two hardcoded built-ins. Boards created from a template capture an independent **snapshot** of its columns.

---

## 1. Decisions (from brainstorm)

1. **Ownership:** per-user custom templates. The 2 built-ins (Three Little Pigs, Sailboat) stay as always-available, **read-only defaults** everyone sees. No migration.
2. **Glyph control:** in the builder the user picks a **color (tone) per column**; the column icon is a fixed default (`layers`). Built-ins keep their specific icons (sail, anchor, …).
3. **Board ↔ template link:** **snapshot**. Creating a board copies the template's columns onto the board; editing/deleting the template later does **not** affect existing boards.

---

## 2. Scope

**In:** a Templates page (list built-ins + your custom), a template builder (create/edit), delete; board creation from any template (built-in or custom); per-column colored glyphs flow through to the board view.

**Out (YAGNI):** sharing/duplicating templates between users, per-column icon picking, template categories/tags, importing/exporting, reordering built-ins, a "default board template" preference.

---

## 3. Data model

### 3.1 Shared protocol (`src/shared/protocol.ts`)

- Add `export type Tone = 'green' | 'blue' | 'coral' | 'purple' | 'amber' | 'pink' | 'slate';` (the existing client `Glyph` `Tone` re-exports this — single source).
- `ColumnDef` gains presentational fields:
  ```ts
  export interface ColumnDef { id: string; title: string; subtitle: string; tone: Tone; icon: string; }
  ```
  `icon` is a free string; the client `Icon` component falls back to a default for unknown names (so the worker never needs the client icon set).
- `BoardSnapshot.meta` changes from `{ template, maxVotes, ownerId }` to:
  ```ts
  meta: { templateName: string; maxVotes: number; ownerId: string; glyph: { tone: Tone; icon: string } }
  ```
  (the board view renders its header from `templateName` + `glyph`; columns render their own `tone`/`icon`).

### 3.2 Built-in templates (`src/shared/templates.ts`)

Absorb the per-column glyphs (currently in `ui/glyphs.ts`'s `columnGlyph`) and a representative glyph per template (currently `templateGlyph`):

```ts
interface TemplateDef { name: string; glyph: { tone: Tone; icon: string }; columns: ColumnDef[]; }
export const TEMPLATES: Record<TemplateId, TemplateDef> = { … };
```

Each built-in column now carries `tone` + `icon` (e.g. Sailboat `wind` = blue/wind, `anchors` = slate/anchor, …). `ui/glyphs.ts`'s `columnGlyph`/`templateGlyph` maps are **removed** (data now lives on the columns/templates); `templateName` helper stays.

### 3.3 D1 — new `templates` table

```sql
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  columns_json TEXT NOT NULL,   -- JSON: [{ id, title, subtitle, tone }]
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_templates_owner ON templates (owner_id);
```

`columns_json` stores custom columns as `{id,title,subtitle,tone}` (icon implied = `DEFAULT_ICON = 'layers'`).

### 3.4 D1 — `boards` gains a snapshot

Add a nullable `template_snapshot TEXT` column **to the `boards` `CREATE TABLE` statement** in `schema.sql` (fresh DBs — tests, new deploys — get it automatically). Because `schema.sql` is idempotent `CREATE TABLE IF NOT EXISTS`, it will NOT add the column to a DB that already has a `boards` table, so any pre-existing DB (local dev, an already-deployed instance with data) also needs a **one-time** `ALTER TABLE boards ADD COLUMN template_snapshot TEXT;`. The plan handles both (CREATE for fresh; an idempotent ALTER step for existing — wrapped to ignore "duplicate column").

`template_snapshot` JSON shape (captured at create-time):
```ts
{ name: string; glyph: { tone, icon }; columns: ColumnDef[] }  // columns carry id,title,subtitle,tone,icon
```

**Back-compat:** existing boards have `template_snapshot = NULL`; they fall back to `TEMPLATES[board.template]` everywhere a snapshot is read. (`boards.template` is kept as the source-template ref/label.)

---

## 4. Worker

### 4.1 Template CRUD — `/api/templates` (all behind `requireSession` + `requireOrigin`)

New `src/worker/templates/{repo.ts,routes.ts}`:

- `GET /api/templates` → `{ builtins: [...], custom: [...] }`. Built-ins from `TEMPLATES` (id, name, glyph, columns, `readOnly:true`); custom from D1 for `c.get('userId')` (parsed columns + applied default icon).
- `POST /api/templates` `{name, columns:[{title,subtitle,tone}]}` → validate, generate id (uuid) + per-column ids (uuid/slug), insert, return the created template.
- `PUT /api/templates/:id` → owner-only (404 if not owned); validate; update `columns_json` + `updated_at`.
- `DELETE /api/templates/:id` → owner-only; delete. (Existing boards are unaffected — they hold snapshots.)

**Validation.** Add to `LIMITS` (in `shared/protocol.ts`): `templateName: 60`, `columnTitle: 60`, `columnSubtitle: 120`, `templateColumnsMax: 6`. Rules: `name` 1–60 chars; **1–`templateColumnsMax` columns**; each column `title` 1–60 non-empty, `subtitle` ≤120, `tone` ∈ `Tone`. Reject otherwise with 400. The same validation runs on POST and PUT (shared validator).

### 4.2 Board creation — `POST /api/boards`

Body unchanged in shape (`{name, template, maxVotes}`), but `template` is now a **reference** (built-in slug **or** custom template uuid):

- Resolve the reference → a `template_snapshot`:
  - built-in (`template in TEMPLATES`) → `{name, glyph, columns}` straight from `TEMPLATES[template]`.
  - else custom: load D1 `templates WHERE id=? AND owner_id=?` → 400 if missing; build snapshot `{name, glyph:{tone: columns[0].tone, icon: DEFAULT_ICON}, columns: parsed+default-icon}`.
- Persist `boards.template` (the ref) + `boards.template_snapshot` (JSON). Owner membership unchanged.
- Board JSON (list + get) gains resolved `templateName` + `glyph` (from snapshot, or `TEMPLATES[board.template]` for old boards) so `BoardCard` renders them.

### 4.3 DO seeding — pass columns, not a template id

- `BoardDb.seed` signature changes to take the resolved snapshot:
  `seed(snapshot: { name, glyph, columns: ColumnDef[] }, maxVotes, ownerId)`.
- DO `meta` table gains `template_name`, `glyph_tone`, `glyph_icon`. DO `columns` table gains `tone`, `icon`.
- `snapshot(userId)` returns the new `meta` shape (`templateName`, `glyph`) and columns with `tone`/`icon`.
- The Worker (`ws.ts`) resolves the board's snapshot (from `template_snapshot` or `TEMPLATES[board.template]`), JSON-encodes it into a single header **`x-template-json`** on the upgrade, plus the existing `x-max-votes`/`x-owner-id`/`x-board-id`. The DO parses `x-template-json` and seeds. (`x-template` header dropped — the DO no longer needs the hardcoded map.)

> This keeps the DO atomicity/seed invariants intact (still a synchronous seed from passed data, no D1 read in the DO). `x-template-json` for ≤6 small columns stays well under header limits.

---

## 5. Frontend

### 5.1 Templates page — `/templates`

New route (linked from the board-list top bar: a "Templates" button). Lists:
- **Defaults** section: the 2 built-ins, read-only, with a "Default" badge and a glyph + column preview.
- **Your templates** section: custom templates with a glyph, column count, and Edit / Delete actions. Empty → a "New template" CTA.

A "New template" button opens the builder.

### 5.2 Template builder (modal)

`src/client/templates/TemplateBuilder.tsx` — create or edit:
- **Name** field.
- **Columns** editor: each row = a tone swatch picker (7 tones), Title, Subtitle, a remove (×) and ▲▼ reorder controls. "Add column" appends (cap 6, min 1). A pure `templateReducer` (add / remove / move / edit-field / set-tone) holds the working state — easy to unit-test.
- Live glyph preview per row from the chosen tone.
- Save → `POST`/`PUT` then close + refresh; errors keep the modal open with an inline message (same pattern as `CreateBoardModal`).

### 5.3 Create-board modal

- The Template `<select>` (kept — preserves the `getByLabelText(/template/i)` + `selectOptions` test) now lists **built-ins (always, from static `TEMPLATES`) + your custom templates (fetched on open)**. Built-ins render synchronously so the existing test still resolves `'sailboat'`.
- A small "Manage templates" link under the select → navigates to `/templates`.
- The glyph preview beside the select reflects the selected template's representative glyph.

### 5.4 Board view glyphs

`Column` renders its glyph from `col.tone`/`col.icon` (from the snapshot) instead of `columnGlyph(col.id)`. The board-view header renders from `state.glyph` + `state.templateName` (new `meta`). `ui/Glyph.tsx` re-exports `Tone` from shared; `Icon` gains a safe fallback for unknown names.

### 5.5 API client (`api.ts`)

Add `listTemplates()`, `createTemplate(t)`, `updateTemplate(id,t)`, `deleteTemplate(id)`.

---

## 6. Testing

- **Worker:** template CRUD (create/list/edit/delete, **owner-scoping** — can't edit/delete another user's template, 404), validation (name, 1–6 columns, tone), board-create snapshot (board persists a snapshot with the right columns), **old-board fallback** (null snapshot → built-in columns), DO seed-from-`x-template-json` (`init` columns carry tone/icon; meta carries templateName/glyph).
- **Frontend:** `templateReducer` (add/remove/move/edit/tone — pure, high-value), the builder component (add a column, pick a tone, save calls `createTemplate`), the Templates page (lists built-ins + custom, delete calls `deleteTemplate`), create-modal dynamic options. Preserve every existing test hook (dialog role, labeled Name/Template/Max-votes, `Add board`, `add card`/`upvote`/`votes`/`delete`).
- **Update existing tests** whose fixtures change: `reducer.test.ts` (new `meta` shape), `boardroom.handlers.test.ts` (`db.seed` now takes a snapshot), `boardroom.ws.test.ts` (asserts columns still seed).
- **E2E:** create a custom template (2–3 columns, chosen tones) → create a board from it → board shows those columns with the chosen colors; edit the template → existing board unchanged (snapshot); delete the template → existing board still works.

---

## 7. File structure (new/changed)

```
src/shared/protocol.ts        # Tone, ColumnDef +tone/+icon, BoardSnapshot.meta reshape
src/shared/templates.ts       # TemplateDef with glyph + columns carrying tone/icon
src/worker/db/schema.sql      # + templates table, + boards.template_snapshot
src/worker/templates/repo.ts  # D1 template CRUD
src/worker/templates/routes.ts# /api/templates routes
src/worker/boards/{repo,routes}.ts  # snapshot on create; resolved templateName/glyph in board JSON
src/worker/ws.ts              # pass x-template-json
src/worker/boardroom/{boarddb,boardroom}.ts  # seed(snapshot,…); meta/columns +tone/icon; init reshape
src/client/api.ts             # template CRUD wrappers
src/client/templates/{TemplatesPage,TemplateBuilder,reducer}.tsx
src/client/boards/CreateBoardModal.tsx  # dynamic options + Manage link
src/client/board/{BoardView,Column}.tsx  # glyph from snapshot/meta
src/client/board/reducer.ts   # meta reshape (templateName, glyph)
src/client/ui/{Glyph,icons,glyphs}.ts  # Tone from shared; Icon fallback; drop columnGlyph/templateGlyph
src/client/App.tsx            # /templates route
```

---

## 8. Build sequence (high level — detail comes from writing-plans)

1. Protocol + built-in `TEMPLATES` carry tone/icon; `Tone` to shared; `Icon` fallback. Update board view/Column/reducer + their tests to the new `meta`/column shape (no behavior change yet).
2. D1: `templates` table + `boards.template_snapshot` (schema + migration note).
3. DO: `seed(snapshot,…)`, meta/columns +tone/icon, init reshape; `ws.ts` passes `x-template-json`; board-create snapshot + resolved board JSON.
4. Worker template CRUD routes + repo (TDD).
5. Frontend: API wrappers → `templateReducer` → builder → Templates page → create-modal dynamic options → `/templates` route.
6. E2E.

---

## 9. Open decisions (confirm at review)

1. **Template builder placement** — a dedicated `/templates` page + a builder **modal** (recommended). Alt: builder as its own full page.
2. **Default custom-column icon** — `layers` (a neutral stack). Fine?
