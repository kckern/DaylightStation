# Art Admin — Library (keyboard-first curation) · Design

**Date:** 2026-06-22
**Status:** Approved design, ready for implementation plan
**Scope:** Phase 1 of an `/admin/content/art` section supporting the ArtMode screensaver
(`frontend/src/screen-framework/widgets/ArtMode.jsx`).

---

## 1. Problem

ArtMode draws from named **collections** defined in `data/household/config/art.yml`. Today a
collection is a pure **rule** evaluated live against each work's `metadata.yaml`
(e.g. `impressionism = {dateMin:1860, dateMax:1900}`). There is:

- **no way to hand-curate** — you can't pull a bad fit out of a collection or pin a special one in;
- **no per-work editing UI** — fixing a wrong date, a bad crop anchor, or removing an
  inappropriate work means hand-editing YAML on the data volume;
- **no write path at all** — the art backend is entirely read-only.

We want a fast, **keyboard-first** admin tool to cycle through the art library and
tag / flag / hide / re-anchor / edit works at culling speed.

## 2. Membership model — "Hybrid" (Model C)

Rules stay as the **auto-populating base**; hand-curation layers on top. A work is a member
of collection `K` iff:

```
( ruleMatches(K, work)  OR  work.tags includes K )
AND work.hidden !== true
AND work.flagged !== true
AND not (work.exclude includes K)
```

New per-work `metadata.yaml` fields (all optional, all default absent):

| Field | Type | Meaning |
|-------|------|---------|
| `tags` | `string[]` | Hand-added collection memberships. Tag name **is** a collection name. |
| `exclude` | `string[]` | Collections this work is pulled *out* of (overrides a rule match). |
| `hidden` | `bool` | Dropped from **all** rotation, quietly. |
| `flagged` | `bool` | Dropped from rotation **and** surfaced in a "Flagged" review filter. |
| `crop_anchor` | `string` | Already exists; now editable. `object-position` keyword(s). |

`title`, `artist`, `date`, `medium`, `category`, `display` already exist and become editable.

**Scope boundary:** Phase 1 curates **classic file-based art only** (the per-work folders under
the `classic` art scope, which have a writable `metadata.yaml`). Immich-backed collections
(`kids`, `favorites`) are **out of scope** — they have no `metadata.yaml`, and Immich already
owns tagging/favoriting. The Library source filter only lists file-based scopes.

## 3. Backend

### 3.1 New router — `backend/src/4_api/v1/routers/admin/art.mjs`

Mounted under the existing admin router (`/api/v1/admin/art`). Reuses the existing
`artSource` scan (mtime-cached) for listing; writes go straight to `metadata.yaml`.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/admin/art/works` | List works. Query: `source` (scope, default `classic`), `tag`, `flagged`, `hidden`, `q` (title/artist search), `page`, `pageSize`. Returns `{ total, page, works: [{ id, image, meta }] }` where `id` is the work folder path and `meta` includes the new fields. |
| `GET` | `/admin/art/quicktags` | Returns the configured digit→tag map (from `art.yml`). |
| `PATCH` | `/admin/art/works/:id` | Read-merge-write a subset of metadata fields into that work's `metadata.yaml`. Body = partial `{ tags?, exclude?, hidden?, flagged?, crop_anchor?, title?, artist?, date?, medium?, category?, display? }`. Validates `crop_anchor` via the same vocabulary `cropFocus` accepts; preserves all unlisted fields and the file's existing key order/comments as much as the YAML writer allows. |

`:id` is the work's folder path under the scope; the router normalizes it and rejects
`../` traversal (same guard pattern as `admin/config.mjs`). Writes run as the in-process
node user, which owns the data volume — no `docker exec`/chown dance.

### 3.2 Resolver merge — `backend/src/1_adapters/content/art/collections.mjs`

`buildArtPredicate(def)` stays as the rule. Add a thin wrapper used by `ArtAdapter` selection
that, given a collection key `K`, its def, and an entry:

```
isMember(K, def, entry) =
  (buildArtPredicate(def)(entry) || (entry.meta.tags||[]).includes(K))
  && entry.meta.hidden !== true
  && entry.meta.flagged !== true
  && !(entry.meta.exclude||[]).includes(K)
```

This is the change that makes tag/hide/flag/exclude actually affect what ArtMode shows. It is
pure and unit-testable with no IO. `artSource` must surface the new fields in `entry.meta`
(it already passes metadata through; add `tags`, `exclude`, `hidden`, `flagged` to the
projected set).

### 3.3 Config — `art.yml` quick-tags

Add an optional top-level key consumed by the admin UI only:

```yaml
quickTags: [impressionism, baroque, romantic, favorites, sketches, prints]  # digits 1..n
```

Absent → no digit shortcuts (palette still works). Lives in `art.yml` because the entries are
collection/tag names.

## 4. Frontend — `frontend/src/modules/Admin/Art/`

### 4.1 Integration (existing Admin conventions)

- **Nav:** add `{ label:'Art', icon:IconPhoto, to:'/admin/content/art' }` to `AdminNav.jsx`.
- **Routes:** in `AdminApp.jsx`, `path="content/art"` → `<ArtLibrary/>` (Phase 1). Tabs for
  Collections / Presets&Schedule are stubbed for later phases.
- Files: `Art/index.js`, `Art/ArtLibrary.jsx`, `Art/Loupe.jsx`, `Art/GridView.jsx`,
  `Art/useArtCuration.js` (data + mutation hook), `Art/keymap.js` (binding table → handlers),
  `Art/Art.scss`.

### 4.2 Interaction model

Two modes over the same filtered work list:

- **Loupe** (default) — one focused work: large preview, live metadata panel, position counter,
  "✓ saved" indicator. A faint 3×3 numpad-compass overlay shows the current crop anchor.
- **Grid** — thumbnail overview with a cursor; same keys flag/tag/hide without zooming.
  `Enter` toggles Loupe ⇄ Grid (Grid cursor ⇄ Loupe focus stay in sync).

**Every curation action auto-saves** (debounced PATCH) — no save button. An in-memory
undo stack powers `U`/⌘Z (re-PATCHes the previous field state). All bindings live in
`keymap.js` as a declarative table so they're easy to re-map and to unit-test.

### 4.3 Keymap (approved)

| Keys | Action |
|------|--------|
| `←/→`, `J/K` | prev / next work |
| `↑/↓` | (grid) move by row |
| `Enter` | toggle loupe ⇄ grid |
| `/` | focus search/filter |
| `A` | toggle auto-advance (jump to next after any curation action) |
| `U`, `⌘Z` | undo last action |
| `1…9` | toggle quick-tag (from `art.yml quickTags`) |
| `T` | tag palette — fuzzy type-ahead, unlimited tags, Enter applies |
| numpad `1–9` | set `crop_anchor` compass (7=top-left … 5=center … 3=bottom-right) |
| numpad `0` | clear anchor (center) |
| `X` | toggle `hidden` |
| `F` | toggle `flagged` |
| `Backspace` / `-` | **remove focused work from the currently-filtered collection** (see below) |
| `E` | edit text fields (title/artist/date/…); `Esc` exits back to hotkey mode |

**Remove-from-collection** (`Backspace`/`-`) is only active when the Library is filtered to a
single collection `K`. It does the right thing for either membership source: if the work is in
`K` by a hand-tag, it drops the tag; if it's in `K` by a rule, it adds `K` to `exclude[]`. This
is the keyboard expression of the "removal from collection" requirement; `X`/`hidden` remains
the broader "drop from everything."

While in `E` edit mode, single-key hotkeys are suspended so typing works; `Esc` resumes them.

### 4.4 Logging

Per CLAUDE.md, the Library ships with structured logging from the start
(`getLogger().child({ component:'admin-art-library' })`): mount, source/filter changes,
each mutation (`art.curate` with `{ id, field, value }`), save success/fail, undo.

## 5. Testing

- **Backend unit:** `isMember` merge truth table (rule-only, tag-add, exclude, hidden, flagged,
  combinations); PATCH read-merge-write preserves untouched fields; `crop_anchor` validation;
  traversal rejection.
- **Frontend unit:** `keymap.js` dispatch (key → intended mutation), auto-advance behavior,
  undo stack, edit-mode hotkey suspension. Pure handlers, no DOM.
- **Existing art tests** (`tests/unit/adapters/art/` and the second art test dir noted in repo
  memory) must stay green — run **both** art test directories after the resolver change.

## 6. Out of scope (later phases)

- **Collections tab** — visual editor for `art.yml` rule definitions.
- **Presets & Schedule tab** — `artmode.yml` presets + a `schedule:` (e.g. july-4th in July).
- **Immich curation** — tagging/hiding Immich-backed photos via the Immich API.
- A true crop *rectangle* (we set the anchor keyword only, matching the current cover-crop engine).

## 7. Key files

- Backend: `backend/src/4_api/v1/routers/admin/art.mjs` (new),
  `backend/src/4_api/v1/routers/admin/index.mjs` (mount),
  `backend/src/1_adapters/content/art/collections.mjs` (merge),
  `backend/src/1_adapters/content/art/sources/artSource.mjs` (surface new fields).
- Frontend: `frontend/src/modules/Admin/Art/*` (new),
  `frontend/src/modules/Admin/AdminNav.jsx`, `frontend/src/Apps/AdminApp.jsx`.
- Config: `data/household/config/art.yml` (`quickTags`), per-work `metadata.yaml`.
- Consumes: `frontend/src/screen-framework/widgets/artModes.js` `cropFocus` anchor vocabulary.
