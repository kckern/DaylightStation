# PianoKiosk Transport Design System — Wave 1 Spec

**Date:** 2026-07-28
**Status:** Approved design, pre-implementation
**Basis:** `docs/_wip/audits/2026-07-27-piano-kiosk-playback-controls.md` (findings F1–F16, proposal §4)
**Scope:** build the first `transport/` primitives and migrate Sheet Music, Karaoke/Singalong/Playalong, and Music (audio player); re-point Videos' volume. Producer, Studio, Videos fullscreen, and the `TransportBar` shell are later waves.

## Goals

1. One button primitive and one modal-sheet pattern across every wave-1 player surface.
2. Kill the style-guide violations on the surfaces the player actually sees daily:
   - Sheet Music Key `−`/`+` text-glyph stepper → a direct-pick semitone modal.
   - Sheet Music Tempo and Loop popovers → the same modal pattern.
   - Karaoke/Singalong/Playalong inline volume ± cluster → the course-video volume-button + modal pattern.
   - Music player `MixControls` ± clusters → same volume button + modal.
   - Karaoke card `▶` Unicode glyph → shared SVG icon.
3. Every primitive ships with ≥2 consumers in this wave. No speculative components.

## Design constraints (from the audit and house rules)

- Touch kiosk, no hover; **≥48 px (3rem) targets** everywhere.
- **Inline SVG only — never Unicode symbol characters as button faces** (tofu risk on the tablet WebView is real and documented).
- **No drag sliders** — discrete tap targets.
- Transport bars must stay cheap to re-render; `ScoreTransportBar`'s memo shell is preserved, not rebuilt.
- Modes differ genuinely — parameterize, don't flatten.

## 1 · New primitives — `frontend/src/modules/Piano/PianoKiosk/transport/`

One component per file, colocated `.test.jsx`, one `Transport.scss` imported where the kiosk styles load.

| Component | Responsibility |
|---|---|
| `TransportButton` | The one button primitive. ≥3rem box, SVG-icon and/or text-label faces only, `emphasis='primary'\|'default'\|'quiet'`, `is-on` via `aria-pressed`, disabled dimming, `aria-label` required when icon-only. |
| `TransportSheet` | Modal shell extracted from `VolumeModal`: scrim (tap dismisses), centered sheet, titled header, 48 px close, `role="dialog"` + `aria-modal`. |
| `StepGrid` | Generic direct-pick ladder: rows of 48 px targets, current value lit, optional per-step sub-label. Replaces per-surface `nearestStep` re-implementations. |
| `VolumeControl` + `VolumeSheet` | Compact `volume`-icon button opening the volume sheet (today's `VolumeModal` content: Media + MIDI five-step steppers + Log/Linear toggle, on `TransportSheet`). Always both channels, always `volumeCurve.js`, always `PianoMixContext`. |
| `KeySheet` | Direct-pick transpose grid, −6…+6 semitones, 0 on its own middle row, current offset lit. Footer: "Sounding key: <name>" via `modes/SheetMusic/keyLabel.js` when the written key is known; omitted otherwise. Values outside ±6 (defensive) clamp to the nearest edge for display. |
| `TempoSheet` | `StepGrid` over the existing `TEMPO_STEPS` ladder; each step sub-labeled with resulting BPM (quarter-note icon + number). |
| `LoopSheet` | The score Loop popover's content (rehearsal sections, "Select measures…" two-tap flow, ±1 nudge) on `TransportSheet`; nudge buttons use the new minus/plus SVGs. |

**Icons:** add `minus.svg`, `plus.svg`, `chevron-down.svg`, `quarter-note.svg` to `icons/svg/`; retire `modes/SheetMusic/icons.jsx` (Play/Pause/Restart/Close already exist as shared SVGs).

**Naming collision:** Producer's existing `producer/TempoSheet.jsx` / `producer/KeySheet.jsx` (BPM pad, circle of fifths) are untouched this wave; the `transport/` path keeps imports unambiguous. A later wave folds them in as alternate presentations.

## 2 · Sheet Music migration (`modes/SheetMusic/ScoreTransportBar.jsx`)

**Unchanged:** three-zone geography, four `React.memo` clusters, per-mode gate-in-place rules (Key acts only in Listen; Perform unmounts chrome), the thin-shell perf structure.

**Changed:**
- Key `−`/`+` stepper → one `Key +N` chip (`TransportButton`) opening `KeySheet`; dims/disables outside Listen exactly as today.
- Tempo popover → `TempoSheet`.
- Loop popover → `LoopSheet`.
- View menu **stays a popover** (view options, not transport) but its internals become `TransportButton`/`StepGrid`.
- All bar buttons → `TransportButton`; local icon module deleted.
- Single-open discipline: sheets' scrims self-dismiss; the shared popover backdrop remains only for the View menu.
- **Adds `VolumeControl`** to the right zone (closes audit F6 — the score player currently has no volume affordance).

## 3 · Karaoke / Singalong / Playalong migration (`modes/Singalong/SingalongPlayer.jsx`)

- Volume cluster (`volume-down / NN / volume-up`, media-only, linear) → one compact `VolumeControl`, identical to the course-video button. Playalong gains MIDI level control as a side effect.
- Restart / ±15 skip / play / fullscreen buttons → `TransportButton`.
- Karaoke browser card `▶` (`modes/Karaoke/Karaoke.jsx`) → `<Icon name="play" />`.
- No changes to seek bar, tap zones, or fullscreen behavior this wave.

## 4 · Music migration (`modes/Music/MusicPlayer.jsx`)

- `MixControls` retired; transport row gains a compact `VolumeControl`.
- Shuffle / prev / play / next / repeat → `TransportButton` (`emphasis='primary'` on play; shuffle/repeat use `is-on`).
- Auto-hide chrome preserved; while the volume sheet is open the chrome is pinned visible, and the idle timer restarts on sheet close.

## 5 · Videos re-point + deletions

- `PianoVideoChrome` volume button opens the shared `VolumeSheet`.
- Delete `VolumeModal.jsx` and `MixControls.jsx` (+ tests) once consumers are migrated.

## 6 · Enforcement & testing

- **Glyph lint test** (unit test in `transport/`): scan `modules/Piano/PianoKiosk/**` JSX source for non-ASCII symbol characters used as button content; allow-list musical spellings (`♯ ♭ ♩`) in notation contexts. Locks F2 permanently.
- **Size test:** `TransportButton` computed min box ≥ 48 px in default and `dense` sizing.
  - **Deviation:** wave 1 shipped without a `dense` size variant — no consumer needed one, so it was dropped (YAGNI) rather than built speculatively. The size test covers default sizing only; add `dense` back if/when a real consumer calls for it.
- New unit tests: `StepGrid` (lit step, pick), `KeySheet` (clamp, footer name, disabled propagation), `TransportSheet` (scrim dismiss, close), `VolumeControl` (opens sheet, both channels wired).
- Updated: `ScoreTransportBar.test.jsx`; `VolumeModal.test.jsx` content moves to `VolumeSheet.test.jsx`; `MixControls.test.jsx` deleted.
- Post-deploy verification: reload the piano tablet kiosk; eyeball Sheet Music (Key/Tempo/Loop sheets, volume), Karaoke (volume button, card icons), Music (transport row, volume).

## Out of scope (later waves)

Producer's Unicode play/stop and sheets unification, Studio drag slider + undersized targets, Videos fullscreen overlay unification, `TransportBar` shell + `ScrubBar`/`SkipButtons`/`PositionReadout`, skip-numeral icon overlays (F1), `useLoopTransport.js` deletion (F16).
