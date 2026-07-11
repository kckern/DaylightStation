# Piano Kiosk — Wave 0 Foundation (Design)

**Date:** 2026-07-10
**Status:** **Implemented + Wave 0b done.** Wave 0 (F5/F1/F3 + skeleton primitive + course-wall
proof; #3 fixed) merged to main. Wave 0b (per-surface skeleton rollout — ~15 loading surfaces
routed to `SkeletonGrid`/`SkeletonList`/`SkeletonStage`, error/empty kept as text) on
`feat/piano-backlog-completion`.
**Parent:** `docs/_wip/audits/2026-07-10-piano-kiosk-redesign-laundry-list-audit.md` (triage +
sequencing). This is the first build cycle from that backlog.

## Scope

Wave 0 is a **primitives** cycle — the small foundation residue left after the 48 pulled
commits. It deliberately does **not** touch per-surface feature redesigns (those are Wave 2).

**In scope:** F5 spacing scale · F1 touch-reset consolidation · F3 count-aware balanced grid
(which also fixes surface #3, Games) · the F4 **Skeleton primitive** + one proof surface.

**Out of scope (→ Wave 0b, its own spec):** the per-surface bespoke skeleton rollout and
routing the ~8 inline `"Loading…"` bypasses. Wave 0 ships the primitive and proves it on the
course/poster wall; Wave 0b applies it everywhere.

Decisions taken during brainstorming: F3 uses a **balanced+centered** helper (not CSS auto-fit,
not per-menu hardcoded counts); F4 skeletons are **per-surface bespoke** but **split** so Wave 0
stays tight.

---

## F5 · Spacing scale

Add a 4px ramp to `:root` in `frontend/src/Apps/PianoApp.scss`, beside the existing color /
type (`--t-*`) / radius (`--r-*`) scales:

```
--sp-1: 4px;   --sp-2: 8px;   --sp-3: 12px;  --sp-4: 16px;
--sp-5: 24px;  --sp-6: 32px;  --sp-7: 48px;
```

**Adoption is opportunistic, not a big-bang refactor** of all 2595 lines. Wave 0 converts only
the spacing on the surfaces it already touches (the menu/games tile grid gutters and
`.piano-mode` padding). The rest migrates as later waves touch each surface. Document the scale
in a comment next to the other scales so it's the obvious default going forward.

## F1 · Touch-reset consolidation

Fold the scattered kiosk-reset rules into one documented base block on `.piano-app`, replacing
the copies at `PianoApp.scss:94-98` and the global `focus-visible` at `:1747`:

```
.piano-app {
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
  * { -webkit-tap-highlight-color: transparent; }
  :focus-visible { outline: none; }        // already present — consolidate here
}
// Escape hatch: real text fields must stay selectable/editable.
.piano-app input, .piano-app textarea, .piano-app [contenteditable] { user-select: text; -webkit-user-select: text; }
```

**Leave `touch-action` per-element.** Several surfaces need specific values (`pan-x`, `none`
for drag/pan/canvas); globalizing it on `.piano-app` would break those. Only the tap-highlight /
selection / focus concerns are globalized here.

## F3 · Count-aware balanced grid *(also fixes #3 Games)*

**Problem:** `.piano-menu__tiles` is hardcoded `grid-template-columns: repeat(5, …)` (built for
the 10-item home menu). Games' 4 tiles therefore fill 4 of 5 columns and clump left with an
empty 5th column.

**Helper** (new pure module, e.g. `frontend/src/modules/Piano/PianoKiosk/tileGridLayout.js`,
unit-tested — mirrors the `columnsForCount` idea already in `whoIsPlayingLayout.js`):

```
// Fewest-empty rectangle, capped at `max` columns.
export function balancedColumns(count, { max = 5 } = {}) {
  const n = Math.max(0, Math.floor(count) || 0);
  if (n <= 1) return 1;
  const rows = Math.ceil(n / max);
  return Math.ceil(n / rows);
}
```

Verified: 10→5×2 (**home layout unchanged**), 4→4×1 (**Games fixed**), 5→5×1, 6→3×3, 7→4+3,
8→4×2, 9→3×3.

**Wiring:**
- `.piano-menu__tiles` → `grid-template-columns: repeat(var(--tile-cols, 5), minmax(8rem, 15rem)); justify-content: center;`
- `PianoMenu` and Games' `GamePicker` compute `balancedColumns(items.length)` and set
  `style={{ '--tile-cols': cols }}` on the `<ul>`.
- Keep the existing portrait override sensible (it currently forces 5 equal columns; make it
  honor `--tile-cols` too, or leave home-specific).

This is the shared **balanced grid primitive**; the same helper can later drive poster-wall
rebalancing (#8's 6→3+3) with a different `max`.

## F4 · Skeleton primitive (+ one proof surface)

Build a reusable shimmer primitive under `frontend/src/modules/Piano/PianoKiosk/` (component +
SCSS):
- `Skeleton` — base shimmer block (respects `prefers-reduced-motion`: static, no shimmer).
- Composable pieces: `SkeletonBox`, `SkeletonText` (line runs), `SkeletonPoster` (2:3 tile).
- Tokens/animation live in `PianoApp.scss` using the `--sp-*` scale + existing radii.

**Proof surface:** the course/poster wall (`CourseGrid` loading state) — render a grid of
`SkeletonPoster`s matching the real poster layout instead of the bare `PianoEmpty loading` text.

**Explicitly deferred to Wave 0b:** converting every other loading surface (album grid, lecture
list, score, lesson grid, studio playback, singalong, video player, picker) and routing the
inline `piano-mode__placeholder` "Loading…" bypasses. That rollout gets its own spec so each
surface's skeleton can be shaped to its content.

---

## Testing

- `balancedColumns` — pure unit test across counts 0–12 (pin 10→5, 4→4, 6→3, 7→4).
- `PianoMenu` / `GamePicker` — assert the `--tile-cols` var matches the item count's balance.
- `Skeleton` — renders N placeholders; honors `prefers-reduced-motion` (no shimmer class).
- Visual verification once the dev server is back: re-screenshot the Games menu (4 tiles now
  centered, no empty column) and the course wall loading state (poster skeletons).
- Guardrail: full `frontend/src/modules/Piano/PianoKiosk` vitest run stays green; `vite build`
  stays clean.

## Risks / notes

- Home menu is already **DONE** (5×2); F3 must not disturb it — `balancedColumns(10)=5` keeps it
  identical. Verify in the screenshot pass.
- F1's global `user-select:none` must not break Settings sliders/dropdowns/inputs — hence the
  `input/textarea/contenteditable` escape hatch. Confirm the Sound-tab controls still work.
- F5 adoption is intentionally limited this wave to avoid a risky 2595-line sweep.

## Next

`writing-plans` → a task-by-task implementation plan (F5 → F1 → F3 → Skeleton primitive → proof
surface), each with its test. Then execute (worktree isolation optional).
