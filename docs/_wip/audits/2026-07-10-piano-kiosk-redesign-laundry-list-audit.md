# Piano Kiosk — Redesign Laundry List

**Date:** 2026-07-10
**Status:** Captured, not yet designed. Parked for a later brainstorming/design pass.
**Source:** Verbal walkthrough of everything that feels wrong across the piano kiosk.

This is a **kiosk-wide redesign** backlog. It is deliberately broad — "the tip of the
iceberg." Roughly half the items share **one root cause** (no shared kiosk design system:
no touch-reset, no standard tile/grid primitive, no skeleton primitive, no spacing scale).
The other half are **feature-level redesigns** of specific surfaces.

Recommended sequencing when we pick this up: **(A) a design-system foundation pass**
(touch-reset + tile/grid/skeleton/spacing primitives), then **(B) per-surface redesigns**
that build on it, each as its own spec → plan cycle.

---

## Surface-by-surface

### 1. Connect / first-load gate
**Code:** `frontend/src/Apps/PianoConnectGate.*`, `frontend/src/modules/Piano/PianoKiosk/PianoEmpty.jsx`

- **Not touch-safe.** Tapping produces stray blue rectangles / focus outlines /
  text-selection highlights. The kiosk is touch-only — no mouse, no text selection, no
  focus rings. Kill all of that (ideally globally, not per-component).
- **The modal is weak — full redesign.**
  - The green **Connect** button does nothing (a successful connection auto-advances), so
    it is dead weight → remove it.
  - **Bluetooth Settings** is genuinely useful → keep it, give it an icon.
  - "Continue without a keyboard/piano" is currently just text → promote to a real button.
  - **Turn off** → also a real button.
  - Add a **Reboot device** button (the reboot API already exists / is already used).
  - Rethink as ~3 clear tiles / primary buttons instead of one button + loose text.

### 2. Main menu tiles
**Code:** `frontend/src/modules/Piano/PianoKiosk/PianoMenu.jsx`, `PianoTile.jsx`

- Currently smashed together: no outer margin, uneven heights when labels wrap.
- Rebuild as a proper balanced flexbox: consistent gutters, **equal tile heights
  regardless of word-wrap**, balanced layout. Rethink the layout/design system here from
  scratch (this becomes the reusable tile primitive).

### 3. Games submenu
**Code:** `frontend/src/modules/Piano/PianoKiosk/modes/Games/Games.jsx`

- Same disease as the main menu: needs to be **vertically + horizontally centered**, with
  **fixed tile heights** regardless of wrap. Should consume the same tile primitive as #2.

### 4. Loaders everywhere
**Code:** many (audit needed)

- Many screens show a bare **"Loading…" text**. Find every occurrence and replace with
  **meaningful skeleton loaders** that match the shape of the content being loaded.
  Establish a skeleton primitive as part of the foundation pass.

### 5. Settings menu (Sound / MIDI / Feedback)
**Code:** `frontend/src/modules/Piano/PianoKiosk/PianoSettingsSheet.jsx`

- Feels thrown-together; the three tabs don't cohere. Rethink and redesign the whole thing.
- Add a **power / restart control** that can restart the whole subsystem (MIDI + sound +
  feedback) in one action.
- Instrument selection lives here today but deserves its own UX (see #12).

### 6. "Who's playing?" modal
**Code:** `frontend/src/modules/Piano/PianoKiosk/WhoIsPlayingPrompt.jsx`, `useWhoIsPlaying.js`, `whoIsPlaying.js`

- Inconsistent: **sometimes shows the "turn off screen" button, sometimes doesn't.** It
  should *always* show it. Find why there are effectively two versions (parameterization?)
  and unify so the control is always present.

### 7. Header home button
**Code:** `frontend/src/modules/Piano/PianoKiosk/PianoChrome.jsx` (home SVG in the header)

- The home/logo SVG is **too small with too much padding** → hard to tap.
- Make it **nearly fill the header height** (leave ~5px margin) so it's an easy, obvious
  tap target back to home. It doesn't need to be 100% of the height, but far bigger than
  now with far less surrounding padding.

### 8. Poster grids (Courses, Play-along, Sing-along)
**Code:** `frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseGrid.jsx`, `CourseCards.jsx`, `CourseTile.jsx`; `modes/Singalong/*`; play-along surfaces

- When a row doesn't naturally wrap, **balance it**. If everything *could* fit on one line
  but that wastes vertical space, **force multiple rows** and center them:
  - 6 items → 3 + 3, centered on both axes.
  - 5 items → staggered / horizontally centered.
- Cap against "above the fold" (~12 items) before forcing multi-row.
- Distribute so the items fill the available space nicely rather than clumping left.

### 9. Staff / notation rendering (Studio + video sidebar)
**Code:** `frontend/src/modules/Piano/components/ActionStaff.*`, `CurrentChordStaff.*`; sidebar staff usage in `modes/Videos/PianoContextRail.jsx`

- The **staff is still getting cut off** → needs better margins.
- Notes render **flush-left** → they should be **horizontally centered** within the staff.

### 10. Course video screen
**Code:** `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.jsx`, `PianoVideoChrome.jsx`, `PianoContextRail.jsx`; `components/ChordNamePanel.jsx`

- Spacing around the video is still off.
- The **chord speller (`ChordNamePanel`)** is mispositioned in the Studio context.

### 11. Studio record button + recording lifecycle
**Code:** `frontend/src/modules/Piano/PianoKiosk/modes/Studio/Studio.jsx`, `StudioRecordings.jsx`, `useStudioRecorder.js`, `studioRecording.js`

- The **Record** button is just dropped in with **no real recording lifecycle** (arm →
  record → stop → review → save/discard). Redesign the recording experience end-to-end.

### 12. Instrument picker
**Code:** currently inside Settings (`PianoSettingsSheet.jsx`); instrument model in `instrumentSpec.js`, `VoicePicker` (producer)

- Picking a new instrument should be its own **dedicated UX / lifecycle**, not a settings
  sub-list.
- Add **instrument icons** — emoji placeholders are acceptable for now.

---

## Cross-cutting themes (the "foundation" pass)

These recur across most of the surfaces above and should be solved once, centrally:

1. **Touch-reset / kiosk base styles** — no focus rings, no text selection, no tap
   highlight, no accidental scroll/drag affordances. (#1, and everywhere.)
2. **Tile primitive** — equal-height, balanced, consistently-gutter'd tiles used by the
   main menu, games menu, connect gate. (#1, #2, #3.)
3. **Balanced grid primitive** — row/column balancing + centering + above-the-fold cap for
   poster grids. (#8.)
4. **Skeleton loader primitive** — content-shaped skeletons replacing "Loading…" text.
   (#4.)
5. **Spacing scale** — a real spacing/margin system so "smashed together" and "cut off"
   stop happening. (#2, #9, #10.)

## Feature-level redesigns (each its own spec)

- Connect-gate modal (#1) — buttons + reboot + bluetooth.
- Settings menu overhaul + subsystem restart (#5).
- Who's-playing "turn off screen" unification (#6).
- Studio recording lifecycle (#11).
- Instrument picker UX + icons (#12).

---

*Not yet triaged for priority. Next step when resumed: brainstorming pass to decompose into
ordered specs, foundation first.*
