# CycleGame — Design & Usability Evaluation (Stern Review)

**Date:** 2026-06-03
**Scope:** `frontend/src/modules/Fitness/widgets/CycleGame/` (lobby, race screen, speedometer, countdown, results, recap, shared tokens)
**Mode:** Evaluation only. No code changes, no remediation. Graded against industry-standard rubrics.
**Reviewer stance:** Adversarial. The goal is to find what is wrong, not to congratulate what works.

---

## Executive Verdict

The CycleGame is **competent engineering wearing two different outfits at once.** The race-time experience (`CycleRaceScreen`, `CycleSpeedometer`, `CountdownStoplight`, `RaceResults`) is genuinely designed — it has a stated aesthetic, atmospheric backgrounds, condensed broadcast typography, and non-trivial data-viz (log/linear auto-scaling, collision-avoided tag layout). The **lobby** (`CycleGameHome`) — the first and most-used screen, the one in the submitted screenshot — does **not** belong to that design system. It re-invents the palette inline, abandons the display font, and reads as generic dark-mode product chrome.

The result is a product that announces a bold concept in its token file and then fails to deliver it on the screen the user actually lands on. Add a serious latent motion failure under the TV kiosk, several WCAG AA contrast and keyboard violations, and a layer of dead CSS, and the honest grade is a **C+ / B−**: solid bones, undelivered vision, real accessibility debt.

### Scorecard

| Rubric | Grade | One-line judgment |
|---|---|---|
| **Visual Design & Aesthetics** | **C** | A named aesthetic that the entry screen ignores; timid single-accent palette; inconsistent iconography. |
| **Design-System Cohesion** | **D+** | Token SSOT exists and is bypassed by the lobby. Two palettes, two type systems, palette drift. |
| **Typography** | **C−** | Display/mono system defined in tokens, unused in the lobby. Default system sans on the hero screen. |
| **Nielsen Usability Heuristics** | **C+** | Good empty-state discipline & reserved layout; broken-looking "—" records, hidden two-tap gesture, unlabeled volume metaphor. |
| **Accessibility (WCAG 2.1 AA)** | **C−** | ARIA roles present, but faint-text contrast fails AA, modals don't trap/restore focus or honor Escape, ghost picker is `onPointerDown` (keyboard-dead). |
| **Information Architecture & Layout** | **B−** | Sensible three-zone layout, reserved value slot avoids rug-pull; records rail has weak hierarchy & indistinguishable avatars. |
| **Motion & Micro-interaction** | **B** | Thoughtful CSS motion. *(Initial concern that the TV kiosk nullified it was investigated and disproven — see §7.)* |
| **Code/Style Maintainability** | **C+** | Clean prop-driven components; undermined by duplicated color arrays, dead CSS rules, and inline palette duplication. |
| **Overall** | **C+ / B−** | Strong race screen, under-delivered lobby, fixable but real debt. |

---

## 1. Visual Design & Aesthetics — **C**

**The headline problem: the stated aesthetic is not on screen.**

`_cgTokens.scss:1-2` literally names the concept:

> *"Shared cycle-game design tokens — 'Velodrome Broadcast HUD'. A pro-cycling broadcast cockpit: near-black surfaces with a radial vignette, per-rider electric lane accents, condensed display type + mono telemetry."*

That is a strong, ownable direction. The race screen honors it. The **lobby does not** — it redefines `$cgh-bg: #0e0f13` (`CycleGameHome.scss:7`) instead of the token's `$cg-bg: #0a0b0f`, uses no `cg-backdrop` vignette, and renders the title in plain `font-weight: 800` system sans (`CycleGameHome.scss:46-51`). The "broadcast cockpit" promised by the tokens is absent from the screen the user sees first. This is the single most damaging aesthetic finding.

**Timid, evenly-distributed palette (the exact anti-pattern to avoid).** The lobby is near-monochrome dark with a single cautious blue accent (`#7aa2ff`) sprinkled uniformly across tiles, presets, steppers, records, and the volume bar. There is no dominant color, no sharp contrast moment, no hierarchy of emphasis through color. The screenshot reads as "a settings page," not "a race lobby about to fire a starting gun."

**Inconsistent iconography in the Starting Grid.** The race-type tiles use a coherent stroked-glyph language (map-pins, stopwatch, ghost). But the bike slots below them mix registers badly: clean silhouette glyphs (bicycle, ab-wheel, rower) sit beside a literal **brand wordmark — "Nicoday" — rasterized into a tiny circle** (visible in the screenshot, sourced from `bike.iconSrc`). A photographic/wordmark equipment image next to flat vector glyphs is a jarring inconsistency and looks unfinished.

**What is genuinely good (credit where due):**
- The race screen's atmosphere — layered radial gradients + vignette + optional ambient Plex video (`CycleRaceScreen.jsx:160-173`) — is exactly the kind of depth the lobby lacks.
- The `cg-ghost` treatment (grayscale + `mix-blend-mode: color` tint, `_cgTokens.scss:33-50`) is a tasteful, reusable spectral effect.
- The speedometer is a real instrument, not a progress bar dressed up.

The race-time visuals would grade **B+**. The lobby drags the section down to **C** because it is the front door.

---

## 2. Design-System Cohesion — **D+**

There is a single-source-of-truth token file. The lobby ignores it. That is the worst of both worlds: the cost of a design system without the benefit.

- `CycleGameHome.scss:7-16` redeclares an entire parallel palette (`$cgh-bg`, `$cgh-panel`, `$cgh-border`, `$cgh-accent`…) that is *almost but not exactly* the token values (`#0e0f13` vs `#0a0b0f`; `#101218` vs `#12141b`). Two near-identical grays now drift independently. Change the brand accent once and you must change it in at least two files.
- `LINE_COLORS = ['#3ddc84', '#ff9f43', '#a66cff']` is hard-duplicated in **both** `CycleRaceScreen.jsx:10` and `RaceRecap.jsx:15`. Per-rider identity color is a design token living as a magic array in two components.
- The lobby's monospace stack is spelled out inline (`ui-monospace, SFMono-Regular, Menlo, monospace`, e.g. `CycleGameHome.scss:274`) rather than referencing the token's `$cg-mono: 'JetBrains Mono', …`. So the lobby's "telemetry" numbers aren't even the same monospace face the race screen uses.

A design system that the primary screen opts out of is not a design system; it's documentation of intent. **D+.**

---

## 3. Typography — **C−**

- The tokens define a deliberate pairing — `Roboto Condensed` display + `JetBrains Mono` telemetry (`_cgTokens.scss:19-20`). The lobby uses **neither**. The "Cycle Race" hero title is default system sans at 1.9rem/800 — generic, the precise "AI-slop" default the design guidelines warn against.
- Numeric values that should feel like instrumentation (preset values, stepper readout, ghost meta) fall back to generic `ui-monospace` rather than the chosen JetBrains Mono, so the "broadcast telemetry" character never lands in the lobby.
- Positive: where the race screen *does* apply `$cg-display`/`$cg-mono` and the `cg-eyebrow` mixin (`_cgTokens.scss:53-60`), the typographic voice is distinctive and correct. The grade is dragged down purely by the lobby's non-participation.

---

## 4. Nielsen Usability Heuristics — **C+**

Evaluated against the canonical 10.

**#1 Visibility of system status — partial.**
- The Records rail frequently renders **"—" as the score** (visible repeatedly in the screenshot). A goal chip ("3.00 km") with a dash where the result should be reads as *broken/unfinished data*, not "no time recorded." Users cannot distinguish "incomplete record" from "rendering bug."
- Empty bike slots give no textual affordance — just a glyph. There is no "Tap to add rider" label. (Worse, `.cgh-slot__rider-name` is styled at `CycleGameHome.scss:359-365` but **never rendered** in `BikeSlot`, so even assigned riders show no name in the grid — see Dead CSS, §8.)

**#2 Match between system and real world — weak phrasing.**
- "Furthest in the clock" (`CycleGameHome.jsx:144`) is contorted English for "go as far as you can before time runs out." Race-type hints are the primary explainer copy and should be plainer.

**#4 Consistency & standards — the volume control violates it.**
- The right-rail volume is an unlabeled 11-segment bar where the **first segment is a red mute toggle**, mids are blue, and the active level glows green (`CycleGameHome.scss:780-806`). Three color meanings, zero labels, an idiosyncratic metaphor. Nothing communicates that segment 1 means mute or that this is even interactive vs. a meter. This is a learn-by-poking control on a screen meant to be glanceable.

**#6 Recognition rather than recall — the grid leans on recall.**
- Bikes are identified *only* by icon (and, per above, no name label renders). To assign the right rider to the right physical bike, the user must recall which equipment maps to which glyph. The "Nicoday" wordmark tile underscores how fragile icon-only identity is.

**#7 Flexibility & efficiency — the ghost two-tap gesture is a discoverability trap.**
- `GhostPicker` commits on the *second* tap of a focused card; the first tap only focuses/scrolls (`CycleGameHome.jsx:439-446`). The only hint is small body copy: *"tap to focus, tap again to choose"* (`:455`). On a touchscreen this is genuinely surprising — users will tap once, see nothing commit, and assume it's unresponsive. Defensible for a remote-control kiosk, but it is presented as a generic touch surface with a one-line caption as the entire onboarding.

**#10 Aesthetic & minimalist design — undercut by dead UI rules.** (see §8)

**Heuristics handled well (credit):**
- **#5 Error prevention:** the Start button is correctly disabled until `canStart` (race type + ≥1 rider), with an unmistakable grayed treatment (`CycleGameHome.scss:84-91`).
- **Layout stability:** the reserved-height `cgh-value-slot` (`:189-195`) deliberately prevents a layout "rug pull" when the value step appears — a thoughtful, above-average detail.
- Empty states exist for every list (no bikes, no records, no past races) rather than rendering nothing.

---

## 5. Accessibility (WCAG 2.1 AA) — **C−**

**What's right:** `aria-pressed` on race-type tiles; `role="dialog"`/`aria-modal` on both pickers; `aria-label` on slots, steppers, close buttons; decorative SVGs marked `aria-hidden`/`focusable="false"`; `role="tablist"`/`role="tab"`/`aria-selected` on the picker tabs. This is more ARIA hygiene than most internal tools ship. Good.

**What fails:**

1. **Keyboard-dead ghost selection (serious).** Ghost cards fire on `onPointerDown` (`CycleGameHome.jsx:479`). Keyboard activation (Enter/Space) produces a synthetic *click*, never a pointerdown — so a keyboard user **cannot select a ghost at all**. This is a hard WCAG 2.1.1 (Keyboard) failure on a core path.

2. **Contrast below AA.** `$cgh-faint: #5b626e` on `$cgh-bg: #0e0f13` ≈ **3.0:1**, under the 4.5:1 AA floor for normal text. It is used for the value-step hint ("Pick Distance, Time, or a Ghost…", `:197-201`), empty states (`:124-128`), and record timestamps. The most explanatory copy on the screen is the least legible.

3. **No focus trap / no focus restore / no Escape.** Both modal sheets (`RiderPicker`, `GhostPicker`) close only via backdrop click or the × button. There is no `Escape` handler, focus is not moved into the dialog on open, and it is not restored to the trigger on close. `role="dialog"` + `aria-modal` is a *promise* of modal focus semantics this code doesn't keep (WCAG 2.4.3, plus dialog APG pattern).

4. **No `:focus-visible` styling anywhere.** Every interactive affordance is hover-only (`transform: translateY` on tiles/presets/cards). Keyboard focus relies on the UA default outline, which kiosk/global resets frequently suppress. There is no designed focus state for any control.

5. **Color-only state in the volume bar.** Level, mute, and "active" are communicated purely by segment color (red/blue/green); buttons are `color: transparent` (`:782-787`). No text, no icon, no non-color cue (WCAG 1.4.1 Use of Color).

---

## 6. Information Architecture & Layout — **B−**

The strongest section.

- The three-zone split — race config (center column) + persistent records/volume rail (`CycleGameHome.jsx:577-672`) — is a sound lobby IA: configure on the left, history/utility on the right, primary CTA pinned at the bottom via `margin-top: auto` (`:59-64`).
- Reserved value slot (§4) is good defensive layout.
- The ghost picker's day-column grouping with sticky date headers (`CycleGameHome.scss:706-730`) is a nice scannable structure for race history.

**Deductions:**
- The **Records rail has almost no visual hierarchy and indistinguishable avatars.** In the screenshot every row shows the same generic face at 28px, overlapped (`:673-677`), so the riders are visually identical — the rail conveys "some races happened" but not *whose* or *which mattered*. There is no rank, no date, no winner emphasis. (`.cgh-record__rank` is styled at `:387-399` but, again, never rendered.)
- The repeated "—" scores (§4 #1) make the rail's right column look empty/broken.
- A 260px fixed rail (`:95`) competing with a centered main column means on smaller TV-safe widths the race tiles compress while the rail holds its width — the priority ordering under constraint favors history over the primary task.

---

## 7. Motion & Micro-interaction — **B** *(initial concern disproven)*

The components contain genuinely nice motion: the `cgh-value-in` fade (`CycleGameHome.scss:203-219`), `RaceResults` staggered row reveal via `animationDelay: i*90ms` (`RaceResults.jsx:57`), the countdown number "punch-in" keyed on value (`CountdownStoplight.jsx:24-28`), and hover lifts throughout.

**Correction (2026-06-03):** The first draft of this audit flagged — as the report's highest-severity finding — that a global `*, *::before, *::after { animation-duration: 0s !important; … }` rule in `TVApp.scss` would silently nullify all of this motion under the kiosk. **That was wrong, and has been verified wrong.** The current `frontend/src/Apps/TVApp.scss` contains no such rule. The global animation kill actually lives in `frontend/src/modules/Menu/Menu.scss`, **scoped to `.menu-items-container`** (with a comment: *"Kill expensive animations … that cause jank on TV hardware"*). CycleGame renders in the fitness player content area, **not** inside `.menu-items-container`, so its transitions and `@keyframes` are **not** suppressed. The motion designed here actually plays.

Lesson recorded: the original claim leaned on a remembered location for the kill rule rather than the current source. Grade revised from a provisional **D** to **B** — the motion is tasteful and, importantly, real on the deployment target.

---

## 8. Code / Style Maintainability — **C+**

Component code is clean: fully prop-driven, presentational/container separation is real, PropTypes everywhere, structured logging wired at lifecycle points (picker open/close, ghost focus). That is above the bar.

The **SCSS is carrying dead weight that signals drift:**
- `.cgh-record__rank` (`:387-399`) — styled, never rendered.
- `.cgh-slot__rider-name` (`:359-365`) — styled, never rendered (riders have no name label in the grid).
- `.cgh-ghost-list` / `.cgh-ghost-row*` (`:593-613`, `:693-703`) — a whole prior ghost-list UI superseded by the day-column card UI, left in the stylesheet.
- `.cgh-ghost-disc` (`:585-590`) and `.cgh-slot--ghost` (`:580-583`) — orphaned ghost-slot styling.

Dead rules in an 814-line stylesheet are how the *next* engineer mis-judges what the component actually does, and they are circumstantial evidence that the lobby has been iterated on without cleanup. Combined with the palette duplication (§2), the styling layer is the weakest part of an otherwise tidy codebase.

---

## Prioritized Findings (severity-ranked, no remediation performed)

| # | Severity | Finding | Evidence |
|---|---|---|---|
| 1 | ~~High~~ **Retracted** | ~~Designed CSS motion inert under the TV kiosk's global animation kill~~ — investigated and **disproven**; the kill rule is scoped to `.menu-items-container`, which CycleGame does not render inside. Motion plays. | §7 |
| 2 | **High** | Ghost selection is keyboard-inaccessible (`onPointerDown`) | `CycleGameHome.jsx:479` |
| 3 | **High** | Lobby ignores the design-system tokens — wrong palette, no display/mono font, undelivered "Broadcast HUD" aesthetic on the front door | §1–3; `CycleGameHome.scss:7-16` vs `_cgTokens.scss:1-20` |
| 4 | **Med** | Modals lack focus trap, focus restore, and Escape-to-close despite `aria-modal` | `CycleGameHome.jsx:287-336`, `448-519` |
| 5 | **Med** | Faint text fails WCAG AA contrast (~3.0:1) on key explanatory copy | `CycleGameHome.scss:14`, `:197-201`, `:124-128` |
| 6 | **Med** | Records "—" scores read as broken; no rank/winner hierarchy; identical avatars | §4 #1, §6; `CycleGameHome.jsx:640-670` |
| 7 | **Med** | Unlabeled, color-only, idiosyncratic volume metaphor | `CycleGameHome.scss:780-806` |
| 8 | **Low** | Inconsistent grid iconography (vector glyphs vs. "Nicoday" wordmark) | screenshot; `BikeSlot` `iconSrc` |
| 9 | **Low** | Hidden two-tap ghost gesture with one-line caption as only onboarding | `CycleGameHome.jsx:439-455` |
| 10 | **Low** | Dead CSS + duplicated `LINE_COLORS` token + inline mono stack | §2, §8 |

---

## Closing Statement

This is not a bad widget. The race screen is the work of someone who can design — a real aesthetic, real data-viz, real instrumentation. That is exactly why the lobby is so disappointing: the same author had a complete design system one `@use` away and built the front door without it. Fix the cohesion (adopt the tokens in the lobby), confirm and rescue the motion under the kiosk, close the keyboard/contrast/focus gaps, and clear the dead CSS, and this moves from **C+/B−** to a confident **A−**. The talent is evident in the codebase; it just hasn't reached the screen the user opens first.
