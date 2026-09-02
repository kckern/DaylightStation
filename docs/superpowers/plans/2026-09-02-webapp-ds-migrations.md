# Webapp DS Migrations Implementation Plan (Phases 3–6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the remaining in-scope webapps — Home, Auto, Life, and Media (theme-pack-only) — onto the shipped design system (`@/lib/ui`, `@/lib/theme`), per Phases 3–6 of the unification spec.

**Architecture:** Each app is one task: adopt `AppThemeProvider` + its pack, replace app-local chrome/states/fetch patterns with DS primitives, keep all product behavior identical. Media re-parents onto shared behavioral pieces only — its amber art direction stays product-owned.

**Tech Stack:** React 18, Mantine 7.11, DS primitives, vitest, Playwright screenshots for visual verification.

**Spec:** `docs/superpowers/specs/2026-09-02-webapp-design-system-unification-design.md` (Program phases 3–6).
**Prerequisite:** Phases 1–2 merged (the DS + Health revamp branch).

## Global Constraints

- **Behavior parity is the acceptance bar:** every migration ships the same features, routes, and data flows the app had before — this plan restyles and de-duplicates, it never redesigns.
- DS discipline (audit:ui gate is live): colors via tokens only (`/* data-color */` annotation for data-derived), Mantine/DS controls (no native buttons outside lib/ui + dev/), no ad-hoc keydown listeners (use `useHotkey`), motion via tokens.
- The audit baselines must SHRINK with each migration (each app's raw-color count drops as its palette moves to tokens/packs); regenerate `scripts/audit-ui-tokens.baseline.json` downward in the same commit and report old→new counts.
- Each task ends with: that app's unit tests green, phone (390×844) + desktop (1280×900) Playwright screenshots read and described (settled captures: `waitUntil: 'networkidle'` + 2500ms — plain `npx playwright screenshot` catches loading skeletons), a G1–G5 gate self-check sentence per the rubric, commit.
- Screenshot/browse via the dev server (`BASE_URL`/port per the host's running Vite; check `ss -tlnp`).
- Commit trailer (two lines at end of every message):

```
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015tL1XJsneEDtUv5Cpunnh5
```

---

### Task M1: HomeApp (Phase 3)

**Files:** rewrite `frontend/src/Apps/HomeApp.jsx`; delete `frontend/src/Apps/HomeApp.scss` (grep for importers first).

**Interfaces:** Consumes `AppThemeProvider` (pack `home`), `SectionCard`, `LoadingState/ErrorState/EmptyState`, `useApiResource`, `createAppLogger('home')`. Produces: the same camera grid (via existing `modules/CameraFeed/CameraFeed.jsx`, untouched) inside DS chrome. HomeApp has no tabs — use `AppChrome` with a single tab or (simpler, allowed) no AppChrome: a plain header + grid inside `AppThemeProvider`; pick whichever reads cleaner and note it.

- [ ] Rewrite: `useApiResource('api/v1/camera')` replaces the bare fetch; the hardcoded `#1a1a1a`/`#aaa` styling becomes tokens; loading/error/empty states via the triad (ErrorState retry = reload). `useDocumentTitle('Home')` kept.
- [ ] Verify: unit-test the data-state rendering if a test exists (create a small one: loading → skeleton, error → retry, success → grid); screenshots both viewports; audit baseline shrinks.
- [ ] Commit: `feat(home): migrate HomeApp onto the design system`.

### Task M2: AutoApp (Phase 4)

**Files:** modify `frontend/src/Apps/AutoApp.jsx`, `frontend/src/Apps/AutoApp.scss`, `frontend/src/modules/Auto/*` (notably `AutoStates.jsx`, `FuelSheet.jsx`, `useAutoApi.js`, `autoLog.js`).

**Interfaces:** Consumes `AppThemeProvider` (pack `auto`), `AppChrome` (its tab state maps 1:1 onto AppChrome tabs), state triad, `Sheet`/`DismissStackProvider`, `useApiResource` (lib), `createAppLogger('auto')`.

- [ ] `$auto-*` Sass vars → `var(--ds-*)` equivalents ($auto-bg→--ds-background, $auto-surface→--ds-surface, $auto-line→--ds-border, $auto-text→--ds-text-high, $auto-accent→--ds-accent, $auto-warn→--ds-warning, $auto-danger→--ds-danger, $auto-ok→--ds-success). Roboto Condensed stays (pack `font` or app-level font rule — art direction, allowed).
- [ ] Hand-rolled header + `.auto-tabs` bottom bar → `AppChrome` (tabs: overview/fuel/service/docs per current tab state; inline SVG icons). `.auto-sheet`/FuelSheet scrim → DS `Sheet` + `DismissStackProvider`.
- [ ] `AutoStates.jsx` (Loading/Failed/Empty) → the DS triad (delete the local file once no importers remain).
- [ ] `useAutoApi.js`: delete the local `useApiResource` and import the lib one (same contract — it was the donor); keep the per-resource hooks and the `autoApi` write helpers. `autoLog.js` → `createAppLogger('auto')` facade (keep the module's export surface).
- [ ] Verify per Global Constraints (all Auto views reachable, fuel logging sheet opens/submits against the dev backend, baseline shrinks). Commit: `feat(auto): migrate AutoApp onto the design system`.

### Task M3: LifeApp (Phase 5)

**Files:** modify `frontend/src/Apps/LifeApp.jsx`; delete `frontend/src/Apps/LifeApp.theme.js`; modify `frontend/src/modules/Life/components/{LifePage,SectionCard,LoadingState,ErrorState,EmptyState}.jsx` call sites; modify `frontend/src/modules/Life/hooks/*.js` (fetch → DaylightAPI-backed).

**Interfaces:** Consumes `AppThemeProvider` (pack `life`), `AppChrome` (desktop keeps a rail — Life's nested Plan nav group maps to tabs + an in-view secondary nav; nav DEPTH must survive, flatten nothing), DS triad + `SectionCard`, `useApiResource`, `createAppLogger('life')`.

- [ ] `LifeApp.theme.js` → pack `life` via `AppThemeProvider` (hex ramps identical to the base — verify visually nothing shifts). Mantine `AppShell`/`Burger`/`NavLink` chrome → `AppChrome`; the household-member `Select` becomes a headerAction.
- [ ] `modules/Life/components/` triad + SectionCard → re-export shims over the DS versions first (`export { LoadingState } from '@/lib/ui'`), then inline the imports at call sites and delete the shims (two commits fine). `modules/Life/theme/semantics.js` stays (domain semantics, allowed).
- [ ] Hooks: `useLifePlan/useLifelog/useDrift/useAlignment/useLifeUser` move from raw `fetch` to `DaylightAPI` (auth + device header) — read each hook's URL/error handling; `useApiResource` where the shape fits, plain `DaylightAPI` calls where hooks are imperative. React-router nested routes UNTOUCHED.
- [ ] Verify: Life's existing component tests green; each route section loads with real data at both viewports; baseline shrinks. Commit: `feat(life): migrate LifeApp onto the design system`.

### Task M4: Media theme pack re-parent (Phase 6)

**Files:** modify `frontend/src/modules/Media/theme/mediaTheme.js`, `frontend/src/Apps/MediaApp.jsx`; optionally `modules/Media/logging/mediaLog.js`, low-risk fetch sites.

**Interfaces:** Media KEEPS its shell (Dock/NavRail/TabBar/NavProvider/MiniPlayer/DismissStack — it is the donor), its amber art direction, its SCSS. The migration is a RE-PARENT, not a rebuild.

- [ ] `mediaTheme.js` becomes `createAppTheme(PACKS.media)` extended with Media's documented overrides (amber ramp, Inter, its component defaultProps) — the semantic roles (`surface/textHigh/...`) get Media's values via the pack's `colors` override so `--ds-*` vars resolve to the amber system inside Media. `MediaApp.jsx` wraps in `AppThemeProvider pack={mediaPackExtended}` (provider accepts an object) instead of its bare MantineProvider — verify `forceColorScheme="dark"` behavior is preserved (add the prop passthrough to AppThemeProvider if needed; that's a DS change, keep it additive).
- [ ] `mediaLog.js` → `createAppLogger('media')` delegation (export surface unchanged). Media's own DismissStackProvider stays (do NOT swap mid-flight — note as future cleanup).
- [ ] Verify: Media's test suite green; browse/detail/fleet views screenshot-identical in character (amber, layouts unchanged) at both viewports; no behavioral change. Commit: `feat(media): re-parent mediaTheme onto the DS base pack`.

---

## Final verification (whole plan)

- [ ] `npm run audit:ui` — every rule at or BELOW the pre-migration baseline; report the shrink.
- [ ] `npx vitest run frontend/src` targeted app suites green.
- [ ] All four apps + /health + /dev/ds-gallery load clean at both viewports.
- [ ] Whole-branch review, merge, deploy per host rules.
