# Piano kiosk: the Sound and Maintenance sheets are unusable on the landscape touch tablet

**Date:** 2026-09-02
**Found by:** KC, screenshots of the live kiosk (Sound, Sound → Browse instruments, Piano maintenance, Maintenance → Connection details, Maintenance → Advanced recovery)
**Status:** fixed — merged to `main` 2026-09-02 via `piano/settings-landscape`; see the plan.
**Severity:** the two adult/player settings surfaces of the kiosk. Changing an instrument or pairing Bluetooth — the two things a person opens these sheets for — are the two hardest things to do in them.
**Surfaces:** `frontend/src/modules/Piano/PianoKiosk/SoundPanel.jsx`, `OperatorDrawer.jsx`, `PianoSheet.jsx`; styles in `frontend/src/Apps/PianoApp.scss` (`.piano-sheet` 152–169, `.piano-sound-panel` 2488–2585, `.piano-operator-drawer` 2587–2643)
**Design that was supposed to govern this:** `docs/_wip/plans/2026-07-11-piano-kiosk-settings-rebuild-design.md` (marked *superseded*; nothing supersedes it — the piano README describes the sheets in three sentences)

---

## What happened

The chip in the kiosk chrome opens the **Sound** sheet on tap and **Piano maintenance**
on a 550 ms hold (`docs/reference/piano/README.md` ~213). Both render as a 480 px
drawer hung off the right edge of a 1280×800 landscape canvas, filled top to bottom
with identical full-width grey rectangles. Every one of the nine maintenance
actions — from "Play test note" to "Reboot tablet" — is the same shape, same colour,
same weight. Nothing has an icon. Nothing fits without scrolling. The instrument
browser is a four-level accordion of unmarked pills with no way back out from the
bottom. Arming a tablet reboot changes a word and nothing else.

The design doc these were built from promised big favourite tiles, a curated house
shortlist, icon-led tone cards with custom pill selects, a hardware status dot, a
ranked recovery ladder, and "Connect / Bluetooth" as a first-class hardware action.
None of that is on screen.

---

## Why: the styles exist, the markup that wore them was deleted

Commit `87b8ba68f` (2026-08-23, *"feat(piano): rebuild kiosk sound and maintenance
settings"*) rewrote `SoundPanel.jsx` (359 lines → 121) and `OperatorDrawer.jsx`
(296 → 102) onto the new shared `PianoSheet` shell. The rewrite dropped every
component-specific class name from the JSX and left the rules in `PianoApp.scss`.

Grepped 2026-09-02 across `frontend/src/**/*.jsx`:

| Rule still in `PianoApp.scss` | Used by any JSX |
|---|---|
| `.piano-sound-panel__tileicon`, `__tilename`, `__tone`, `__toneicon`, `__tonename`, `__tonetype`, `__step`, `__foot`, `__save`, `__favorite` | no |
| `.piano-operator-drawer__hw`, `__hwdot`, `__hwlabel`, `__hwname`, `__connect`, `__screen-off`, `__screen-error`, `__recovery`, `__restart`\*, `__reload`, `__hint`, `__feedback-open` | no |

\* `__restart` is applied — to "Repair connection", not to a restart.

Of the ~30 rules written for these two panels, the ones that still hit anything
are `__tiles`/`__tile` (both tile sections are empty in this household — see B1),
`__browse-toggle`, `__family`, `__voices`, `__voice`, `__steps`, `__type`,
`__save-actions`, `__current`, `__details`, `__advanced`, `__status`.
Everything else on screen falls through to one rule — `.piano-sheet button`
(`PianoApp.scss:163`) — which is why every control is the same grey rectangle.

The commit also left `&__tonehead` declared twice (≈2530 and ≈2553), and the
3 600-line `PianoApp.scss` is now carrying ~120 lines of dead design for these
sheets.

This is the whole story of the "slop" look: the visual design was written once,
in July, and then the markup was rebuilt out from under it in August with no
visual check. The lint pass that followed (`33eac3fdf`) touched the files and
saw nothing wrong, because nothing was wrong *for a linter*. jsdom tests assert
strings and callbacks; no test or reviewer looked at the screen.

---

## The issues

### A. Landscape touch tablet, treated as a phone

**A1. 37 % of the screen, 63 % scrim.** `.piano-sheet__panel { width: min(30rem, 92vw) }`
(`PianoApp.scss:155`) → 480 px of a 1280 px canvas. The other 800 px is dimmed
app you can't touch. On this hardware a settings surface should own the canvas
and lay out in columns.

**A2. `92vw` measures the wrong thing.** The sheet is `position: fixed` inside
`PianoDesignScale`'s `transform: scale()` canvas, so its containing block is the
1280×800 canvas — but `vw` is the *real* viewport. On the tablet the two agree;
on any other screen the width math is nonsense.

**A3. Every control is a 480 × 48 stripe.** The worst Fitts geometry for a
finger: an enormous horizontal target, a thin vertical one, stacked at 8 px gaps.
Nine of them in Maintenance. The design doc's answer — chunky tiles in a grid —
is already styled (`__tiles`, a 2-col grid) and renders nothing.

**A4. Nothing fits.** Maintenance is nine actions plus three disclosures; about
five fit at 800 px (screenshots 3–5). Sound needs a scroll to reach Piano level.
In a landscape grid none of it needs to scroll.

**A5. Raw browser scrollbar.** A bright white default scrollbar on a near-black
sheet, painted over the panel's right border (screenshots 2–5). `PianoApp.scss`
styles scrollbars elsewhere in the app; not here.

**A6. Adjacent destructive actions, identical, 8 px apart.** "Restart piano app"
sits directly above "Reboot tablet" (screenshot 5), same grey, same weight. A
mis-tap on a touch screen reboots the tablet.

**A7. No icons on any action.** The house set at `modules/Piano/ui/icons/svg/`
already has `bluetooth-active`, `connection`, `instruments`, `reverb`, `chorus`,
`volume`, `settings`, `system-reboot`, `system-shutdown`, `chevron-down`, `back`.
The sheets use exactly one of them (`close`). The only other glyph is the emoji
from `instrumentIcon.js`, which renders only on the (empty) tile sections.

**A8. The kiosk already has the right primitive and doesn't use it.** The README
describes "a centered modal sheet for any control that offers a set of discrete
choices — direct-pick ladders for stepped values … rather than a slider". That is
`transport/TransportSheet.jsx` + `transport/StepGrid.jsx`. `SoundPanel` re-implements
`StepGrid` as a private `StepChoices` (lines 23–31) inside a *different* shell
(`PianoSheet`) with a different scrim, header, close button and focus policy. Two
sheet systems, two step pickers, one app.

### B. The instrument picker

**B1. The funnel's front door is missing.** The design is three tiers —
Favourites → house shortlist → full browse. In this household `favorites` is
empty for the guest/no-player case and the live config
(`data/household/piano/config.yml`) has **no `shortlist:` key at all** (0 matches).
`buildFunnel` therefore returns two empty tiers and the sheet's only offer is
"Browse instruments" (screenshot 1). The curated tier was never populated, and the
UI gives no hint it exists.

**B2. Four levels deep, and the same four back.** Chip → Sound → Browse instruments
→ family → voice. Nothing collapses on pick; you climb back out by scrolling.

**B3. The families have no affordance.** They're `<details>/<summary>`, and
`.piano-sheet summary { display: flex }` (`PianoApp.scss:166`) removes Chrome's
disclosure marker. Nothing replaces it. Screenshot 2 is sixteen featureless pills
("Piano", "Chromatic Percussion", "Organ" …) with no sign they open.

**B4. No exit from the bottom of the list.** "Done browsing" is pinned *above*
the list. Once you've scrolled to "Ensemble" there is no back, no close, no sticky
control — just the sheet's X at the top, off-screen.

**B5. Nested scroll trap.** `__voices { max-height: 16rem; overflow-y: auto }`
inside `.piano-sheet__body { overflow-y: auto }`. Two scroll regions under one
finger; the inner one grabs the gesture.

**B6. Not an accordion.** Each `<details>` is independent; open three families
and the list is three grids long.

**B7. Organised by the MIDI spec, not by a person.** "Chromatic Percussion",
"Ensemble", "Synth Effects", "Sound Effects" are General MIDI bucket names. A kid
looking for "the spooky one" or "the church one" has no path.

**B8. Two-up names in a 480 px column, ellipsised, no search, no audition.** You
pick blind, close the sheet, and press a key to find out. "Play test note" exists —
in the *other* sheet, behind a 550 ms hold.

### C. Maintenance: the one thing you came for is the hardest to reach

**C1. "Open Bluetooth pairing" is hidden behind a disclosure and a condition.**
`showBluetooth = config?.bluetooth && (health.state === 'offline' || repair.state
=== 'failed' || connectionDetails)` (`OperatorDrawer.jsx:83`). It renders only
inside the expanded "Connection details" block, mid-section, after three plain
text lines (screenshot 4). The design doc lists "Connect / Bluetooth launcher" as
the first hardware action; the README says Maintenance "exposes … Bluetooth
pairing". It exposes it after a hold, a scroll, a tap on an unlabelled toggle,
and a second scroll.

**C2. "Repair connection" is the top, accented action while the sheet reports
everything connected.** Never disabled, never hidden, never de-emphasised.

**C3. Contradictory status, one screen apart.** Screenshot 4: "Sound controls are
connected." then, in the details below it, "Bridge: reconnecting". Two sources,
no reconciliation.

**C4. Disclosures and actions are the same rectangle.** "Connection details",
"Diagnostics", "Advanced recovery" toggle; "Play test note", "Stop stuck notes",
"Reboot tablet" fire. No chevron, no colour, no grouping tells them apart.

**C5. Three sections with one item each.** "Common problems" → Stop stuck notes.
"Display" → Turn off display. "Feedback" → Record feedback. More heading than content.

**C6. Two `<section>`s with no heading.** Diagnostics and Advanced recovery
(`OperatorDrawer.jsx:104–110`) render as a lone button between two orphaned
rules (screenshots 3–4).

**C7. Expanding a disclosure shoves everything below it off-screen** (screenshot
3 → 4). Nothing is anchored.

**C8. Armed state is invisible.** `className={screenArmed ? 'is-armed' : ''}`
(`OperatorDrawer.jsx:98, 107, 108`) — a bare `.is-armed`. The only piano rule for
it is `.piano-operator-drawer__screen-off.is-armed` (`PianoApp.scss:2611`), on a
class that is never rendered. Arming **Turn off display**, **Restart piano app**
or **Reboot tablet** changes the label to "Tap again…" and nothing else — no
warn colour, no weight, no border. On a touch screen, for a reboot.

**C9. The action result renders at the bottom of the sheet.**
`{action.message && <p …role="status">}` sits after every section
(`OperatorDrawer.jsx:112`). Tap "Play test note" at the top, the outcome appears
below the fold.

### D. Copy and labels

**D1. Every label twice.** `<h3>Piano level</h3>` then `StepChoices` renders
`<strong>Piano level</strong>` (screenshot 1: "PIANO LEVEL" / "Piano level").
"EFFECTS" → "Room sound" → "Room sound type". Three type levels in one 480 px column.

**D2. The euphemism leaks.** "Room sound" hides "reverb", and the dropdown
directly beneath it says "Hall".

**D3. "Pick a player to save sounds."** A dead end — no affordance to pick one.

**D4. Raw OS `<select>`.** `.piano-sound-panel__type select` has no
`appearance: none` (the styled `__tonetype` version is dead), so the tablet opens
the native Android picker over the kiosk.

**D5. "Mute / 25% / 50% / 75% / 100%"** — a word and four numbers in one ladder.

### E. Defects in the code, independent of the look

**E1. `label` leaks into persisted state.** `StepChoices` calls `onPick(step)`
with the whole `{ label, level, on }` (`SoundPanel.jsx:27`); `EffectControl`
forwards it and `applyEffect` spreads it into the bundle (`SoundPanel.jsx:73`).
Every reverb/chorus change writes `reverb.label: "Medium"` into `currentBundle`,
and `saveFavorite(currentBundle)` persists it to `users/{id}/apps/piano/preset.yml`.

**E2. Exact-equality step matching.** `EFFECT_STEPS.findIndex(s => s.level ===
value.level && …)` and `LEVEL_STEPS.findIndex(s => s.value === pianoLevel)`. Any
level not exactly 0/32/64/96/127, or a `pianoLevel` of 0.7, lights nothing.
`transport/StepGrid` hosts were built to replace exactly these "per-surface
`nearestStep` hand-rolls" — this one survived.

**E3. `currentCopy` shows only when nothing matches** (`SoundPanel.jsx:25`) — the
"Current: 55%" hint appears precisely when the user can't act on it.

**E4. Scrim dismisses on `pointerdown`** (`PianoSheet.jsx:32`), not click. A swipe
that starts outside the panel closes it before the finger moves.

**E5. Autofocus lands on Close** (`data-autofocus` on the X, `PianoSheet.jsx:35`).
The first focusable element every time the sheet opens is the one that destroys it.

**E6. Duplicate `&__tonehead` block** in `PianoApp.scss` (≈2530, ≈2553).

---

## What this should be (direction, not a spec)

A full spec belongs in `docs/_wip/plans/`; the shape is clear enough to state.

1. **Own the canvas.** Both sheets become full-canvas landscape surfaces on the
   existing `TransportSheet` shell (one sheet system, one scrim policy, one close),
   laid out as a 2–3 column grid of tiles. Retire `PianoSheet` or make it the
   same thing.
2. **Tiles, not stripes.** Every action is an icon + label tile from the house
   icon set, ≥ 96 px square, with three visual weights: primary (accent),
   normal, destructive (warn/danger, armed state lit). `__tiles` already exists.
3. **Sound = one screen, no browse mode.** Favourites and shortlist as the first
   two rows of tiles (populate `shortlist:` in the live config — the code is
   waiting for it); a flat, searchable, icon-led grid of all voices below,
   grouped by *what a person hears* (Pianos · Keys & Organs · Guitars · Strings ·
   Winds & Brass · Voices · Drums · Synths · Fun), current voice lit, single tap to
   apply, no accordion, no nested scroll. Tone (reverb / chorus / level) as
   `StepGrid` rows in a second column. A "hear it" button that reuses
   `midi.sendNote`.
4. **Maintenance = status card + ranked tiles.** One status card that agrees with
   itself (keys / sound / bridge, one source). Then tiles ranked by how often a
   human actually needs them: **Bluetooth pairing** and **Repair connection** first
   and large, then Play test note / Stop stuck notes, then Display, then Diagnostics,
   with Restart / Reboot in a visibly separate danger zone that shows its armed state.
   Action results render inline under the tile that fired.
5. **Delete the dead SCSS** rather than reconnecting it wholesale — most of it
   assumes the July markup; keep what the grid needs.
6. **Fix E1–E6 regardless.** E1 is a data bug shipping to user preset files today.

---

## Non-findings

- The connection model, `applyBundle`, `usePianoPreset` persistence and the
  bridge are not implicated. The state behind these sheets is fine; the surface is.
- The 550 ms hold to reach Maintenance is deliberate (no Settings gear for kids)
  and is not one of the problems.
- Touch target height (48 px minimum) is honoured everywhere. Height was never the
  issue; shape, density, hierarchy and depth are.

## Verification when fixed

- Screenshots on the tablet (or the design-scale canvas at 1280×800), not jsdom:
  Sound closed, Sound with a voice lit, Maintenance idle, Maintenance with Reboot
  armed. All four must fit without a scrollbar.
- `grep -rho 'piano-\(sound-panel\|operator-drawer\)__[a-z-]*' frontend/src/Apps/PianoApp.scss | sort -u` set-equals the same grep over `frontend/src/**/*.jsx`.
- A saved favourite written after the fix contains no `label` under `reverb`/`chorus`.
