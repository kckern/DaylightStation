# Sheet Music Redesign — Wave 2 Spec

**Date:** 2026-07-28 · **Status:** Approved design, pre-implementation
**Branch:** `worktree-sheetmusic-tabs` (already carries: Courses-style score tabs, L/R hand toggles, mode/layout/hand icons)
**Ships big-bang** with the tab YAML + score-file reorg in one deploy.

## A · Note highlight subtlety

Lit noteheads stop using the mode accent: `NoteHighlightLayer`'s `accent` becomes a fixed near-black ink `#23262b` in every mode. The green struck-correctly glow, Learn's pending marker, and the mode-colored cursor band are unchanged (`ScorePlayer.jsx:1304` keeps `cursorColor` for the band only).

## B · Header: thumbnail + mode selector

- Breadcrumb crumbs gain optional `image` (small square thumb) and `icon` (shared icon name); `PianoChrome` renders them, and a **last** crumb with `onClick` renders as a button (today it's forced inert).
- ScorePlayer publishes `[thumb] Title › ⦿ <Mode> ⌄` — the mode crumb (icon `mode-listen|learn|polish|perform` + label + `chevron-down`) opens **ModeSheet**, a TransportSheet with four icon rows (Listen / Learn / Polish / Perform); picking one calls the existing `onMode` and closes.
- The Listen/Learn/Polish/Perform tab strip is REMOVED from `ScoreTransportBar` (all modes, including Perform, switch via the header). Perform's bar keeps only the page indicator.
- No secondary bottom-left mode indicator.

## C · Titles

- Code: `meta.title = scoreMeta.title || parsed?.title || prettyTitle(<filename from score id>)` — never the literal "Score". `prettyTitle` moves to a shared `scoreTitle.js` (ScoreGrid re-imports).
- Data: sweep every `.mxl` under `media/docs/sheet-music/`, writing `<work-title>` + `<movement-title>` (curated names) into the compressed MusicXML via `adm-zip` (available in the container). Idempotent; skips files that already have a non-empty title.

## D · Key sheet speaks key names

- Grid cells: primary label = sounding key name for that offset (`soundingKeyLabel(keyFifths, keyMode, n)`), sub-label = the offset (`+2` / `0` / `-6`). When the written key is unknown, cells fall back to offset-as-label (today's rendering) and the footer stays omitted.
- Transpose gate WIDENS: Key is enabled in Listen, Learn, and Polish (engrave re-pitches; the evaluator reads expected notes from the engraved steps, so practice modes stay consistent). Perform has no chrome. The `is-dimmed` Listen-only gating is removed.

## E · Tempo

- The right-zone chip face becomes quarter-note icon + effective BPM (`Math.round(baseBpm × tempoMult)`), opening the tempo sheet.
- `TEMPO_STEPS` grows to nine: 50, 60, 70, 80, 90, 100, 110, 125, 150 (%), rendered as a 3×3 grid (three `StepGrid` rows), each cell sub-labeled with its resulting BPM.
- The metronome button becomes icon-only (`metronome` icon, no BPM readout) — pure click on/off toggle, position unchanged.

## F · Loop: direct manipulation

- `LoopControl` chip → a `repeat`-icon TOGGLE plus a quiet `chevron-down` button:
  - No range set: tapping the toggle starts the on-score two-tap selection immediately (existing `onStartSelect` flow with SelectBanner).
  - Range set: the toggle flips looping on/off WITHOUT clearing the range (`enabled` + `onToggleEnabled` props). Lit = looping.
  - The chevron opens the existing LoopSheet (sections, Select measures…, nudges, Clear).
- ScorePlayer gains `loopOn` state (default true; reset true whenever a new range is set). The range→step-span resolution (`rangeSpan` memo, `ScorePlayer.jsx:190`) gates on `loopOn`, so disabling stops the wrap/clamp while `focus` (the range) persists. FocusRangeLayer keeps showing the defined range.

## G · Labels out, divider in

`HandsControl` drops the "Hands"/"My part" text label (aria-label on the group remains for tests/audits); a hairline divider (`.piano-score-divider`) partitions the hand toggles from neighbors in the bar.

## H · View becomes a sheet

`ViewMenu` popover → **ViewSheet** on TransportSheet ("View"): Layout = two icon buttons (`layout-down` "Down the page", `layout-across` "Across"); Size = the existing five-step grid; Keyboard toggle stays; the `<dl>` metadata block is DELETED. The bar's View trigger opens the sheet; the shared popover backdrop (now consumer-less) is removed.

## J · One element bank (no duplicated chrome)

Every control this wave touches comes from the shared `transport/` primitives (`TransportButton`, `TransportSheet`, `StepGrid`) and the shared icon set — no new bespoke button families, no re-implemented verbs. And the course-video chrome converges too: `PianoVideoChrome`'s row (restart, ±15/±30 skips, play/pause, rate chip, A/B loop group, fullscreen) converts from bespoke `.piano-video-chrome__btn` buttons to `TransportButton` (play gets `emphasis="primary"`; loop mark-A/mark-B keep their `is-arming`/`is-on` grammar via the primitive's states; the tap-only seek bar and gate/sequential disabling are unchanged). Superseded `.piano-video-chrome__btn` face styles are swept from `PianoApp.scss`, keeping only layout/row rules. Same verbs, same components, both players.

## I · Ship list

Everything above + already-committed tabs/hands/icons + `piano.yml` `sheetmusic.collections` (Video Games / TV Shows) + file moves into `video-games/`/`tv-shows/` + `._*` AppleDouble cleanup + config reload + one build/deploy (git pull first — Watchtower lesson) + tablet reload + verification.

## Out of scope

Bottom-left mode indicator; long-press loop gestures; 3×3 size picker; Producer/Studio waves; real (non-placeholder) mode icon art beyond the four downloaded ones.
