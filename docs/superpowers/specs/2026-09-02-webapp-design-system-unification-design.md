# Webapp Design System & Unification Program — Design

**Date:** 2026-09-02
**Status:** Approved design, pre-implementation
**Scope:** One program: build a shared design system for the desktop+phone
webapps, then migrate all five onto it — Health (via its own revamp spec),
Home, Auto, Life, Media. Companion spec:
[2026-09-02-health-loseit-revamp-design.md](2026-09-02-health-loseit-revamp-design.md)
(the first consumer).
**Quality bar:** `docs/_wip/audits/2026-08-30-design-system-quality-rubric.md`
— its "shared layer owns behavior, theme packs own art direction" model and
its AI-slop smell check are the operating rules here.

## Current state (survey findings)

Five apps, five chromes:

| App | Mantine | Theme | Shell | Data fetch |
|---|---|---|---|---|
| Life | yes | `Apps/LifeApp.theme.js` (semantic ramps, violet) | Mantine AppShell + Navbar | raw `fetch` (bypasses DaylightAPI) |
| Media | yes | `modules/Media/theme/mediaTheme.js` (amber, most rigorous, native `dark[n]`) | custom Dock + NavRail/TabBar + view-stack | DaylightAPI + providers + WS |
| Health | yes | `Apps/HealthApp.theme.js` (semantic ramps, blue — same shape as Life's) | hand-rolled header, no nav | DaylightAPI ad hoc |
| Auto | no | `$auto-*` Sass vars | hand-rolled header + bottom tabs | `useAutoApi` / `useApiResource` (best pattern) |
| Home | no | none (hardcoded hexes) | `<h1>` | bare `fetch` |

Duplication counts: `{data,loading,error,reload}` hook ×4, Loading/Error/Empty
triad ×3, headers ×5, bottom tabs ×2, sheets/overlays ×4, keydown/hotkey
blocks ×4, logger-facade boilerplate ×5, stat-card pattern ×3. Life's and
Health's themes are structurally identical (same seven semantic ramps,
different hexes, written twice). `lib/ui/Skeleton.jsx` (`ds-` prefixed) is the
deliberate seed of the system; `styles/_breakpoints.scss` exists but only
Media/Menu use it.

Structural bugs fixed by this program:

- The outer unthemed `MantineProvider` in `main.jsx` leaves provider-less apps
  (Auto, Home, Feed, Finance) on Mantine's default light-ish look.
- Life bypasses `lib/api.mjs` entirely (no device header / auth behavior).

## The design system

**Location:** `frontend/src/lib/theme/` (tokens, base theme, packs) and
`frontend/src/lib/ui/` (primitives, extending the Skeleton seed). Imported via
the `@` alias (`@/lib/ui`, `@/lib/theme`). No new package.

### Token contract

- **Semantic ramps** (adopting the Life/Health convention): `background,
  surface, surfaceAlt, border, textHigh, textMid, textLow`. Exposed two ways:
  as Mantine colors (`var(--mantine-color-surface-0)`) **and** mirrored CSS
  custom properties (`--ds-surface`, …) so non-Mantine SCSS consumes the same
  tokens — this is what lets Auto/Media SCSS migrate without rewrites.
- **Status colors:** `other.{success, warning, danger, info, live}` — reserved
  meanings; never reused as data/category colors.
- **Breakpoints:** single source of truth = `styles/_breakpoints.scss` values,
  re-exported in the theme; the mixins (`mobile-only/tablet-up/desktop-up`)
  are the only responsive vocabulary.
- **Motion tokens:** `--ds-motion-*` durations/easings (fast ~120ms, base
  ~200ms, reveal ~300ms) + a named `--ds-motion-live` for the rare justified
  infinite animation. Reduced-motion substitution handled inside primitives.
- **Component defaults** lifted from mediaTheme: touch-target sizes,
  ActionIcon/Button/Badge/Modal/Drawer/Skeleton defaultProps.
- **`createAppTheme(pack)`**: base + pack. A pack is small: `{ name,
  character: '3-4 line direction statement', primaryColor, accent hexes,
  optional font }`. Shipped packs: `health` (blue), `life` (violet), `auto`,
  `home`, `media` (amber, product-owned, extends further — see Phase 6).

### Primitives

Promoted **only from proven duplicates**; each defines behavior and states
(focus-visible, disabled, busy, reduced-motion), not just appearance.

| Primitive | Absorbs | Base implementation |
|---|---|---|
| `AppChrome` | 5 headers, 2 tab bars, 1 navbar | Media's `PrimaryNav` rail (tablet+) / bottom tabs (mobile) + slim header; slots: title, actions, user/date; caps header actions |
| `LoadingState` / `ErrorState` / `EmptyState` | 3 triads | Life's components (tested), restyled on tokens; `ErrorState` requires a retry action prop |
| `Skeleton` | exists | keep as-is |
| `SectionCard` / `StatCard` | Life SectionCard, Health metric-card, Auto stat/bignum | label / big tabular number / trend / sparkline slots; one `emphasis` slot |
| `Sheet` / `OverlayScrim` / `useDismissLayer` | 4 overlay stories | Media's dismiss-stack (Esc, scrim, focus restore, stacking) |
| `useApiResource` | 4 fetch patterns | Auto's hook re-based on `DaylightAPI` (auth + device header); returns states that plug into the triad |
| `useHotkey` | 4 keydown blocks | one helper; the "am I in an input?" check done once |
| `createAppLogger(app)` | 5 logger facades | the lazy child-logger boilerplate, once |
| `DateStepper` | Health date nav, Life scope selector (day mode) | ‹ date › + today shortcut |
| `AskAffordance` | Health AskBar/ChatOverlay/AiMark | generalized chat entry; pairs with existing `modules/Agent/AgentChatSurface` |

### main.jsx fixes

Outer `MantineProvider` gets the base theme + `defaultColorScheme="dark"`;
apps with packs nest their own provider as today. (Kiosk/TV apps and the
`appRegistry` widget world are out of scope — this program is the webapps.)

## Anti-slop controls

Three tiers; Tier 1 mirrors the repo's existing baseline-audit pattern
(`audit-layer-imports.mjs`), wired into the same pre-commit gate.

**Tier 1 — automated (Phase 1 deliverables, not afterthoughts):**

1. `audit-ui-tokens.mjs` (baseline-style): flags hex/rgb/hsl literals, ad-hoc
   `box-shadow`, arbitrary `border-radius`, and integer `z-index` in `Apps/`
   and webapp modules outside theme/pack files. Data-derived colors pass via
   an explicit `/* data-color */` annotation.
2. Duplicate-primitive audit: flags `document.addEventListener('keydown'`,
   hand-rolled scrim divs, skeleton loops, and raw `<button>`/`<select>` in
   styled surfaces outside `lib/ui/`.
3. Motion audit: flags literal `transition:`/`animation:` durations and
   free-hand `@keyframes` outside the theme; infinite animation only via the
   named `--ds-motion-live` token.
4. Undefined-token check: every `var(--ds-*)` reference resolves against the
   token manifest — no silent fallbacks.

Baselines mean existing violations don't block; they can't grow.

**Tier 2 — structural (the correct path is the cheap path):**

5. `useApiResource` + state triad make the complete screen easier than the
   happy-path-only screen; `ErrorState` cannot render without a next step.
6. One focal point per state encoded in primitives (single `emphasis` slot,
   capped header actions) — the "giant centered title + stack of pills"
   composition can't fall out of them.
7. Reduced-motion and focus-visible live inside primitives; features can't
   forget them.

**Tier 3 — human review with teeth:**

8. Pack manifests carry the direction statement and one accent; adding a
   second loud accent or unrelated gradient requires editing the manifest —
   drift becomes a visible decision.
9. Rubric self-audit per phase: B-section gates (G1–G5) against screenshots at
   phone + desktop viewports, plus stress fixtures (longest names, empty data,
   error states, 200% text). Only unhappy-state screenshots catch the
   "superficially polished happy path" signature.
10. Copy rules: no machine labels or AI-plumbing terms in UI text; no emoji as
    status/navigation (house policy — inline SVG only); empty/error copy names
    a next step.

Known limit: Tier 1 can't judge composition — an all-token screen can still be
bland. Tier 3's screenshot audit is the answer; screenshots are audited, not
trusted.

## Program phases

Each phase ends with: that app's Playwright flows green, phone + desktop
screenshot check, deploy, and a G1–G5 gate self-audit.

1. **Phase 1 — DS foundation.** Tokens, base theme, packs, `main.jsx`
   provider fix, the primitives table above, the Tier-1 audit scripts wired
   into pre-commit. Unit tests for hooks/primitives; Playwright screenshots
   for visual verification (jsdom cannot see layout).
2. **Phase 2 — Health revamp on the DS** (companion spec; requirements
   unchanged — shell/header/tabs/sheets/state views now come from `@/lib/ui`).
   The hardening pass: primitives may change freely here, nothing else
   consumes them yet.
3. **Phase 3 — Home.** AppChrome + CameraFeed grid + triad + `useApiResource`.
   Trivial by design: proves the DS isn't Health-shaped.
4. **Phase 4 — Auto.** `$auto-*` Sass vars → `--ds-*` custom properties (1:1
   mapping exists); tab state → AppChrome; `AutoStates` → triad; FuelSheet →
   Sheet. Keeps its write-helper object; read hook re-bases on shared
   `useApiResource`.
5. **Phase 5 — Life.** Pack + AppChrome (desktop keeps a rail so nav depth
   survives); `LifePage/SectionCard/states` merge into DS versions; hooks move
   from raw `fetch` to `DaylightAPI`-backed `useApiResource`.
6. **Phase 6 — Media, theme-pack-only.** The amber system becomes a
   product-owned pack extending the base; `dark[n]` usage re-expressed through
   semantic ramps where meanings align. Adopts shared breakpoints,
   dismiss-stack (it's the donor), logger factory, and `useApiResource` where
   low-risk. Its NavProvider view-stack and MiniPlayer stay — product
   behavior, not chrome drift.

## Governance & docs

- `docs/reference/frontend/design-system.md`: token contract, per-primitive
  when-to-use / when-not-to-use, pack authoring guide, the anti-slop rules.
  Present-tense endstate style per house convention.
- The rule: **new webapp UI uses `@/lib/ui` primitives and tokens; raw values
  only for data-derived cases with the annotation.** Third duplicate of any
  pattern must be promoted into the DS, never copy-pasted.
- Audit scripts + baselines live with the existing audit family in
  `scripts/`.

## Out of scope

Kiosk/TV surfaces (Fitness garage display, screen framework, `appRegistry`
widgets), School, Piano, print design system, Feed/Finance/Admin (they inherit
the fixed base provider but are not migrated), runtime theme switching,
light-mode support (all packs are dark; the token contract doesn't preclude a
light pack later).
