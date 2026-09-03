# Webapp Design System

The shared visual language for the top-level webapps (Health, Life, Auto, Home,
and Media's chrome layer). One token contract, one primitives barrel, one
per-app "pack" for art direction. The goal: every app looks distinct but is
built from the same parts, so a fix or an improvement in one place lands
everywhere.

## Token contract

`frontend/src/lib/theme/tokens.mjs` is the only place raw color, motion, and
breakpoint values are defined. Everything else — Mantine themes, plain SCSS,
components — consumes them, never restates them.

Seven semantic color roles: `background`, `surface`, `surfaceAlt`, `border`,
`textHigh`, `textMid`, `textLow`. Five status colors: `success`, `warning`,
`danger`, `info`, `live`. Motion tokens: `fast` (120ms), `base` (200ms),
`reveal` (300ms), and a shared `easing` curve. Breakpoints (`md`, `lg`) mirror
`frontend/src/styles/_breakpoints.scss` — the two are kept in sync by hand.

Two ways to consume the contract, both backed by the same values:

- **Inside Mantine** (components, JSX using Mantine props): `createAppTheme.js`
  projects the token colors into Mantine's ramp shape, so a role reads as
  `var(--mantine-color-surface-0)`, `var(--mantine-color-textHigh-0)`, etc.
- **In plain SCSS** (anything outside Mantine's styling system): `dsCssVars()`
  emits the same roles as `--ds-*` custom properties (`--ds-surface`,
  `--ds-text-high`, `--ds-danger`, `--ds-motion-base`, …) onto a `.ds-root`
  wrapper. `AppThemeProvider` renders that wrapper, so any SCSS under the
  provider can read `var(--ds-surface)` directly.

A `--ds-*` name that isn't part of the contract is a bug, not a typo that
silently degrades — an unknown custom property falls back to `inherit`, so it
looks fine until the surrounding context changes. `npm run audit:ui` checks
every `var(--ds-*)` reference against the manifest of legal names.

Colors that come from data (a status derived from a value, a chart series, a
sentiment ramp) are the one place a literal color is legitimate. Mark the line
with a `data-color` comment so the audit's `raw-color` rule exempts it:

```scss
color: #f85149; /* data-color: over-budget */
```

Without the annotation, the same line is a violation.

## Packs

A pack (`frontend/src/lib/theme/packs.mjs`) is the only thing that varies
between apps. It owns:

- `primaryColor` — the Mantine color name driving default component variants.
- `accent` — the one hex value the app is allowed to lean on for its own
  identity (exposed as `--ds-accent`).
- `character` — a one-sentence direction statement, so visual drift between
  apps is a declared choice, not an accident.
- Optionally, color-role overrides (merged over the base token colors).

A pack may **not** remove or weaken anything the base contract guarantees:
focus rings, contrast ratios, disabled/hover/error state behavior, touch
target sizing. Those come from `createAppTheme.js` and the shared SCSS and
apply to every pack that doesn't set `themeExtras` (see below) unchanged.

**To add a pack:** add one entry to `PACKS` in `packs.mjs` — `name`,
`character`, `primaryColor`, `accent`, and optional color overrides. Nothing
else needs to change; `AppThemeProvider` picks up any registered pack by name.

### `themeExtras` — the escape hatch

`themeExtras` is an optional top-level key on a pack, applied by
`createAppTheme.js` as a **wholesale, non-deep-merged override**: any of
`colors` / `other` / `components` / etc. it sets fully replaces the base
contract's version of that section, rather than blending into it. It exists
for a product that predates the shared contract, or whose art direction goes
beyond the 7 semantic roles and `accent` — its own component defaults, extra
color ramps, fonts, breakpoints. `modules/Media/theme/mediaTheme.js` is the
one pack using it today: `MEDIA_PACK.themeExtras` layers Media's full
amber/dark Mantine theme (component defaultProps included) on top of the base,
so Media's own `Button`/`Modal`/`Drawer` defaults are the sole authority,
never silently blended with the base contract's generic ones.

Setting `themeExtras` moves ownership, not just styling: a pack that replaces
`components` (or `other`) is no longer covered by the base guarantee above for
whatever it replaced — that pack is now responsible for its own focus rings,
contrast, disabled/hover/error states, and touch target sizing wherever
`themeExtras` takes over. Reach for it only when a pack's identity genuinely
can't fit inside the base contract's 7 roles + `accent`; most packs never need
it.

## Primitives

Everything below is exported from `frontend/src/lib/ui/index.js`. New webapp
UI is built from these, not from raw Mantine or hand-rolled equivalents.

| Primitive | For | Don't use it when |
|---|---|---|
| `AppThemeProvider` | Wraps an app in its Mantine theme + `--ds-*` vars, given a pack name. | You need a second, nested theme scope — packs are per-app, not per-section. |
| `AppChrome` | The app shell: header, responsive primary nav (bottom tabs on mobile, left rail on tablet-up), main scroll region, optional footer. Caps header actions at 3 — quiet chrome is the contract. | The screen isn't a top-level app (e.g. a modal's internal layout) — compose inside `AppChrome`'s `children`, don't nest another `AppChrome`. |
| `Sheet` | A task flow that needs its own scrollable surface and dismiss affordance: multi-step forms, detail drill-in, anything the user is *doing*. Bottom sheet on mobile, right panel on desktop; registers on the dismiss stack so Escape and scrim-click close it; locks body scroll while open. | A yes/no confirmation, a destructive-action warning, or anything that should block the whole screen and demand one decision — use Mantine `Modal` for that; `Sheet` is not centered-attention chrome. |
| `DismissStackProvider` / `useDismissLayer` | Registering any overlay (sheet, custom popover, in-house dropdown) on the single app-wide Escape handler, so nested overlays dismiss top-first instead of racing competing `keydown` listeners. Mantine overlays (`Modal`, `Drawer`, `Popover`, `Menu`) register themselves — pass `managed: true` for those. | The overlay is a native `<dialog>`/Mantine component that already manages its own Escape handling without `useDismissLayer` — don't double-register it as unmanaged. |
| `LoadingState` / `ErrorState` / `EmptyState` | The only sanctioned way to render an async section's loading, failure, and no-data states. `ErrorState` throws if `onRetry` is missing — a dead-end error with no next step is a spec violation, not a shortcut. | A field-level validation error (that's inline form feedback, not a section state) or a state that isn't loading/error/empty (e.g. a partial/degraded state needs its own explicit UI). |
| `SectionCard` | A titled surface panel grouping related content — the house card shape. | A raw list item or a dense table row; `SectionCard` carries header padding and elevation meant for one card per logical section, not per-row repetition. |
| `StatCard` | A label + big tabular number, with optional unit, trend, and sparkline. `emphasis` is the one louder variant a screen may use — at most once per screen. | You need more than one emphasized stat on the same screen — pick the single most important number, or the hierarchy collapses. |
| `Skeleton` | A loading placeholder shaped like the content it stands in for. Mantine-compatible props (`height`, `width`, `radius`, `circle`) for a drop-in swap. Replaces Mantine's own `Skeleton`, which reads as a bright flash on these dark panels. | An indeterminate spinner is more honest than a shaped placeholder (e.g. content whose eventual layout is genuinely unknown). |
| `DateStepper` | Paging a single day backward/forward with a "Today"/"Yesterday" label and a clamp at `max`. | A date *range* picker or multi-date selection — this is single-day stepping only. |
| `AskAffordance` | The entry pill that opens an app's chat/coach overlay (pairs with `modules/Agent/AgentChatSurface`). | Any other kind of search or command input — this is scoped to the ask/chat affordance, not a generic search box. |
| `createAppLogger` | The lazy per-app structured logger (`logger.debug/info/warn/error/sampled`, `.child()`), avoiding import-time logger races. One call per app module. | Ad hoc `console.*` calls anywhere — see the logging framework rules for the general policy this specializes. |

## Data fetching

`frontend/src/lib/hooks/useApiResource.js` is the house `{ data, loading,
error, revalidating, reload }` fetch hook — a GET-backed request wrapped in
the loading/error bookkeeping every app needs, so no screen hand-rolls its
own. In its default mode it behaves like any plain fetch-on-mount hook:
`loading` starts `true` and clears once the request settles, and `reload()`
always re-enters that same loading state. This mode is unaffected by anything
below — no cache read, no cache write, nothing new to opt into.

An opt-in stale-while-revalidate mode (`swr: true`) is for a view whose
structure should survive a refetch rather than disappear behind a loading
state. A small in-memory cache, keyed by the request path and bounded to a
fixed number of entries (least-recently-used eviction), holds the last
successful payload for the life of the tab. When a path already has a cached
entry, the hook renders that value on the very first paint — `loading` is
`false` immediately, and a separate `revalidating` flag reports that a
background refresh is running instead. The fetch still happens; its result
quietly replaces the displayed data and updates the cache, with no loading
state appearing at any point. `reload()` on a path with a cached entry behaves
the same way, which is what lets a mutation's refresh stay invisible instead
of flashing the view back to a loading state. A path with no cached entry yet
behaves exactly like the default mode until its first successful response
seeds the cache.

Cache writes are race-protected: a response is only allowed to overwrite its
path's cached value if it is still the most-recently-issued request for that
path by the time it resolves. This covers both an overlapping reload on one
component and two separately mounted components requesting the same path — in
either case, a slower, superseded response can never clobber a fresher answer
that already landed.

The Health app's day view is the primitive's first consumer of the `swr`
mode; see
[`docs/reference/health/README.md`](../health/README.md#loading-and-refresh)
for what that looks like end to end.

## The rules

- New webapp UI is built from `@/lib/ui` and the token contract — not raw
  Mantine primitives standing in for a house component that already exists,
  and never a literal hex/rgb/motion value where a token applies.
- **Third duplicate gets promoted.** The first two times a pattern (a card
  shape, a state layout, an interaction) appears, it can live locally. The
  third occurrence is copy-paste calcifying into drift — extract it into
  `frontend/src/lib/ui` instead of copying it again.
- `npm run audit:ui` is the enforcement gate. It scans the app roots and
  `lib/ui` itself for five violation classes — raw colors, raw motion/keyframe
  values, hand-rolled `keydown` listeners, native `<button>`/`<select>`
  elements outside `lib/ui`, and `--ds-*` names outside the token manifest —
  and compares each count against a checked-in baseline
  (`scripts/audit-ui-tokens.baseline.json`). A count at or below its baseline
  passes; a count above it fails the gate. **Baselines only shrink.** Fixing
  violations lowers a baseline number in the same change; a new violation
  raising a count above its baseline is a hard failure, never grounds for
  raising the baseline instead.

## Visual verification

`/dev/ds-gallery` renders every primitive together — chrome, both card types,
all three async states, the sheet, the date stepper, the ask affordance — so a
token or primitive change can be eyeballed in one place instead of hunting
across apps. `tests/live/flow/ds/ds-gallery.runtime.test.mjs` drives it at a
phone and a desktop viewport, asserts no horizontal overflow, exercises the
sheet's open/Escape-close cycle, and saves a full-page screenshot per
viewport. Because layout regressions (a wrapper collapsing, a media query
losing specificity) are invisible to jsdom-based unit tests, this Playwright
pass — and a look at the resulting screenshots — is what actually confirms a
design-system change renders correctly; re-run it after any change to tokens,
packs, or `lib/ui`.
