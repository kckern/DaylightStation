# Piano kiosk settings: landscape tile redesign of the Sound and Maintenance sheets

**Date:** 2026-09-02
**Status:** design, agreed with KC; not implemented
**Fixes:** `docs/_wip/bugs/2026-09-02-piano-kiosk-settings-sheets-unusable-on-touch.md` (all of A–E)
**Supersedes:** `docs/_wip/plans/2026-07-11-piano-kiosk-settings-rebuild-design.md` for everything about how the sheets *look*; its funnel, bundle and persistence decisions stand.
**Hardware:** SM-T590 in Fully Kiosk, 1280×800 CSS px landscape, finger only, no keyboard.

---

## 1. Decisions

1. **Both sheets own the canvas.** No more 480 px right-hand drawer. Each sheet is a
   full-canvas panel (canvas minus a 1.5 rem margin) laid out in columns so that
   **no state of either sheet scrolls.** This is a hard acceptance criterion, not
   a goal.
2. **One shell.** `PianoSheet` is deleted. `TransportSheet` gains a `size="canvas"`
   variant and inherits `PianoSheet`'s accessibility (focus trap, Escape, focus
   restore). The kiosk then has one modal shell, one scrim policy, one close button.
3. **Tiles, not stripes.** Every action is an icon-over-label tile built on
   `TransportButton` (SVG icons only — no emoji, per the primitive's own rule).
   Three weights: `primary`, `default`, and a new `danger`. The armed state of a
   two-tap action is visible (warn border + weight), not just a label change.
4. **Instrument picker = family rail + tile grid + tone column** (KC's pick,
   2026-09-02). One tap applies a voice. No accordion, no nested scroll, no
   Browse mode, no `<select>`.
5. **Maintenance = status card + ranked tiles + danger strip.** Bluetooth pairing
   and Repair connection are the two big tiles. Section headings and the
   "Connection details" toggle go away; the status card *is* the details.
6. **Effects are called what the device calls them** — Reverb, Chorus — with the
   house `reverb`/`chorus` icons. "Room sound" leaked its own euphemism.
7. **Dead SCSS is deleted, not revived.** The July rules assume July markup.
8. **The data bug ships fixed regardless of the visual work** (§6, E1).

Out of scope: the chip tap/hold gesture and the "no Settings gear" policy, the
connection model, the producer sheets, per-user preset storage format.

---

## 2. Shell: `TransportSheet size="canvas"`

`frontend/src/modules/Piano/PianoKiosk/transport/TransportSheet.jsx`

```
<TransportSheet open title onClose size="canvas" className>
```

- `size="canvas"`: `.piano-tsheet__panel--canvas { position:absolute; inset:1.5rem;
  max-width:none; max-height:none; display:flex; flex-direction:column; overflow:hidden }`.
  Body is `display:grid` per sheet (below). The panel never scrolls; if a child
  needs to, that is a layout bug.
- Header stays: `<h2>` + 48 px close `TransportButton`.
- Scrim dismisses on **`click`** (not `pointerdown`) so a swipe that starts
  outside the panel does not close it.
- Accessibility moves in from `PianoSheet`: `role="dialog" aria-modal
  aria-labelledby`, Tab/Shift-Tab trap, Escape closes, focus restored to the
  opener on unmount. **Initial focus goes to the first content control**, not the
  close button (the close button keeps `data-autofocus` only as the fallback when
  the body has nothing focusable).
- `PianoSheet.test.jsx`'s three cases move to `TransportSheet.test.jsx` unchanged
  in intent; the "moves focus to its close control" case becomes "moves focus to
  the first content control; close when there is none".
- Callers: `SoundPanel`, `OperatorDrawer`. The producer sheets already use
  `TransportSheet` and are untouched.

`PianoSheet.jsx` and `.piano-sheet` (`PianoApp.scss:152–169`) are removed.

---

## 3. Tile primitive

`TransportButton` grows two things; nothing new is invented.

- `emphasis="danger"` → `.piano-tbtn--danger`: `--piano-danger` border and text on
  the surface colour. `is-on` (armed) fills with the warn colour.
- `layout="tile"` → `.piano-tbtn--tile`: icon above label, `min-height: 5.5rem`,
  `width: 100%`, label may wrap to two lines, optional `sub` line (small, muted)
  under the label for status text.

A rail item is the same button with `layout="rail"` (icon left, label right,
`min-height: 3.5rem`, `justify-content: flex-start`, `is-on` when selected).

Tiles carry their own status: a tile whose action just ran shows the result as
its `sub` for 2.5 s (success) or until the next action (failure), so the outcome
appears **where the finger is**, never at the bottom of the sheet.

---

## 4. Sound sheet

`SoundPanel.jsx`, title **Sound**. Body grid:
`grid-template-columns: 10rem 1fr 19rem; gap: 1rem`.

### 4a. Left: family rail (10 items)

| Rail item | Voices (by GM program; device profile is the source) | Count |
|---|---|---|
| ★ Mine | favourites (up to 8) + house shortlist deduped, favourites first | ≤ 8 + shortlist |
| Pianos | pc 0–7 | 8 |
| Keys & Organs | pc 8–23 (chromatic percussion, organs, accordion, harmonica) | 16 |
| Guitars & Bass | pc 24–39 | 16 |
| Strings | pc 40–51 (solo strings, harp, timpani, string/synth-string ensembles) | 12 |
| Voices | pc 52–54 (Choir Aahs, Voice Oohs, Synth Voice) | 3 |
| Winds & Brass | pc 56–79 | 24 |
| Synths | pc 80–103 (lead, pad, effect) | 24 |
| World | pc 104–111 + the 10 bank-1 Asian folk voices | 18 |
| Drums & Fun | pc 112–127 + Orchestra Hit (55) | 17 |

Mapping lives in a new `voiceFamilies.js` (pure; unit-tested that every
`ALL_VOICES` entry lands in exactly one family and that the family of the
current voice is found). `buildFunnel` is unchanged and feeds **Mine**. The rail
opens on the family containing the current voice (or **Mine** when the current
voice is in it), so the lit tile is on screen the moment the sheet opens.

Voices is small on purpose — it is the family a kid asks for by name. Timpani
staying in Strings and Orchestra Hit moving to Fun follow the ear, not the spec.

### 4b. Middle: voice grid

- 4 columns of `layout="tile"` buttons, `gap: .6rem`. Largest family is 24 → 6
  rows × ~6 rem = fits in the ~40 rem of body height with room to spare.
  **Mine** can hold at most 8 favourites + shortlist; the shortlist is capped at
  16 in `pianoConfigModel` so Mine never exceeds 24 either.
- Tile = family icon + voice name (device spelling; wraps to two lines, never
  ellipsised at this width). Current voice `is-on`.
- Tap → `applyBundle({ ...currentBundle, voice })`. Nothing else changes; nothing
  navigates. The sheet stays open so the player can tap several and listen.
- Empty **Mine** (guest with no shortlist): a single muted line in the grid area,
  "Save a sound and it will show up here." No button.

### 4c. Right: tone column

Four `StepGrid` rows, each under a small icon + label head:

1. **Reverb** — Off · Low · Medium · High · Max (levels 0/32/64/96/127).
2. **Reverb type** — Room · Big room · Hall · Big hall · Plate (values from
   `device.effects.reverb.types`; labels shortened for the tile). Hidden when the
   device profile lists no types.
3. **Chorus** — Off · Low · Medium · High · Max. Type row below it, same rule.
   The "More effects" toggle is gone; both always show.
4. **Piano level** — Mute · 25 · 50 · 75 · 100 (device-wide, remembered by the
   piano; the existing one-line caption stays).

Non-canonical values keep the existing rule *no step is claimed* (the current
test "does not claim a nearest effect step for a legacy noncanonical value"
stands) — the row lights nothing and the head shows "now 55%".

Below the rows:

- **Hear it** (`primary`, `music` icon) — `midi.sendNote(60, 100, 0, 500)`;
  disabled with sub "piano not connected" when output is down. This is the
  audition the picker never had; the same call already exists in Maintenance.
- **Save row**: current voice name in bold, then Save / Update saved sound /
  Saved (disabled) and Remove — the existing `savedExactly`/`savedInstrument`
  logic verbatim, including the 8-favourite limit copy. Guest: one muted line,
  "Pick a player to save sounds." (text, not a button).

### 4d. Icons

New Solar icons via the MANIFEST process (Iconify, `fill="currentColor"`):
`family-piano` (reuse `piano`), `family-keys`, `family-guitar`, `family-strings`,
`family-voices` (reuse `studio` mic), `family-winds`, `family-synths`,
`family-world`, `family-fun`, `star`. `instrumentIcon.js` changes from
keyword → emoji to keyword → icon name with the same rule table (its test is
updated to assert names); it is used for the tile icon so a voice reads by its
family even inside **Mine**.

---

## 5. Maintenance sheet

`OperatorDrawer.jsx`, title **Piano maintenance**. Body grid:
`grid-template-columns: 1fr 1fr; grid-template-rows: auto 1fr auto; gap: 1rem`.

### 5a. Top-left: status card

One card, one source (`usePianoConnection().health`):

| Row | Dot | Text |
|---|---|---|
| Keys | `input.state`: up → on, other → off | "Keys: Digital Keyboard" / "Keys: not connected" |
| Sound | `output.state === 'up'` → on | "Sound: Digital Keyboard" / "Sound: not connected" |
| Bridge | ready → on, connecting/reconnecting → warn, down/unavailable → off | "Bridge: connected / reconnecting… / not running" |

Card head is `health.copy` (the sentence the chip already uses), so the card can
never contradict the chip or itself. The July `__hwdot` colours come back for
this one purpose.

### 5b. Top-right: the two big tiles

- **Bluetooth pairing** — `bluetooth-active` icon. Shown whenever
  `config.bluetooth` exists. `primary` when `health.state !== 'ready'`, `default`
  when ready. Runs `launchAndroidTarget(config.bluetooth)` and logs
  `piano.maintenance.bluetooth` as today.
- **Repair connection** — `connection` icon. `primary` when not ready, `default`
  when ready, disabled with sub "Repairing…" while `repair.state === 'working'`.
  `repair.message` renders as the tile's sub.

### 5c. Middle: everyday tiles (3 across, full width)

Play test note (`music`; disabled with sub when output down) · Stop stuck notes
(`stop`) · Turn off display (`system-shutdown`, two-tap, armed = `is-on` warn) ·
Diagnostics (`settings`) · Record feedback (`record`).

**Diagnostics** swaps the middle+bottom area for `PianoMidiMonitor` with a
`back` tile in its corner; the status card and big tiles stay. The monitor
mounts only while shown (existing test).

### 5d. Bottom: danger strip

A visually separate row, `--piano-danger` rule above it, label "Recovery — these
interrupt whatever is playing": **Restart piano app** (`system-reboot`) and
**Reboot tablet** (`system-shutdown`, only when `config.screensaver.deviceId`).
Both `emphasis="danger"`, two-tap via `useArmedAction`, armed shows `is-on` and
the label "Tap again to restart / reboot". Reboot API failure renders as the
tile's sub (existing test intent kept).

What is gone: the Connection / Common problems / Display / Feedback headings;
the "Connection details" toggle and its three text lines; the "Advanced recovery"
toggle; the sheet-bottom status paragraph.

---

## 6. Code fixes carried regardless

- **E1** `StepChoices`/`EffectControl` pass `{label, level, on}` into the bundle.
  Replace with `StepGrid` and map index → `{ level, on }` (and `{ type }`) in the
  host. Add a test that a saved favourite has no `label` under `reverb`/`chorus`.
  `sanitizeSoundPreset` should also strip unknown keys on read so existing preset
  files heal on next save.
- **E2/E3** the exact-match rule stays (it is a deliberate "don't lie" choice);
  the current value is always visible in the row head, not only on mismatch.
- **E4** scrim on `click`. **E5** initial focus to content. **E6** duplicate
  `__tonehead` goes with the rest of the dead block.
- `.piano-sound-panel` (`PianoApp.scss:2488–2585`) and `.piano-operator-drawer`
  (`2587–2643`) are deleted whole. The new rules live in `Transport.scss` (tile,
  rail, danger, canvas variants) plus a small `SettingsSheets.scss` for the two
  grids and the status card. Acceptance: the grep in the bug report's
  *Verification* section returns the same set from SCSS and JSX.

---

## 7. Config

`data/household/piano/config.yml` gets a `shortlist:` (the code has read it since
July; it has never been populated). Starting set, eight voices a household
actually reaches for:

```yaml
shortlist:
  voices:
    - { pc: 0,  name: Acoustic Grand }
    - { pc: 4,  name: Electric Piano 1 }
    - { pc: 6,  name: Harpsichord }
    - { pc: 19, name: Church Organ }
    - { pc: 24, name: Nylon Guitar }
    - { pc: 48, name: String Ensemble 1 }
    - { pc: 52, name: Choir Aahs }
    - { pc: 11, name: Vibraphone }
```

Config is cached at startup; a container restart (or `reloadHouseholdAppConfig`)
is needed for it to show. This is data on the shared Dropbox tree, so it goes live
on prod before the code deploys — harmless here (today's UI just renders it as a
Recommended row).

---

## 8. Tests

Existing cases that encode the old behaviour and must be rewritten, not deleted:

| Test | Becomes |
|---|---|
| SoundPanel: "orders Current, Saved, Recommended, Browse, Effects, then Piano level" | "renders rail, grid and tone column; rail opens on the current voice's family" |
| SoundPanel: "keeps Browse instruments collapsed and groups the catalog when expanded" | "every device voice is reachable in exactly one family; tapping a rail item shows its voices" |
| SoundPanel: "opens More effects automatically when chorus is active" | dropped — chorus always shows |
| OperatorDrawer: "shows Bluetooth only for unhealthy or detailed connections" | "shows Bluetooth whenever configured; primary when not ready" |
| OperatorDrawer: "keeps feedback adult-only at the bottom" | "keeps feedback adult-only" (position assertion dropped) |
| OperatorDrawer: "hides advanced recovery by default" | "renders restart/reboot in the danger strip with danger emphasis and a visible armed state" |
| PianoSheet: all three | move to TransportSheet |

New: `voiceFamilies.test.js` (partition + lookup); E1 regression; tile status
appears on the tile that fired.

**Visual gate (required — this is the check that was missing in August).**
A Playwright screenshot run on the design-scale canvas at 1280×800 for four
states: Sound (Pianos), Sound (Winds & Brass — the largest family), Maintenance
idle, Maintenance with Reboot armed. Each asserts
`panel.scrollHeight === panel.clientHeight` and saves a PNG to
`tests/_artifacts/piano-settings/` for a human look. The fitness chart harness
(`docs`/memory: screenshot harness waits on a selector) is the pattern.

---

## 9. Files

| File | Change |
|---|---|
| `PianoKiosk/transport/TransportSheet.jsx` (+test) | `size="canvas"`, a11y from PianoSheet, click-scrim |
| `PianoKiosk/transport/TransportButton.jsx` (+test) | `emphasis="danger"`, `layout="tile" \| "rail"`, `sub` |
| `PianoKiosk/transport/Transport.scss` | canvas panel, tile, rail, danger rules |
| `PianoKiosk/SettingsSheets.scss` (new) | the two grids, status card, danger strip |
| `PianoKiosk/voiceFamilies.js` (+test, new) | 9-family partition of `ALL_VOICES` |
| `PianoKiosk/instrumentIcon.js` (+test) | emoji → icon name |
| `modules/Piano/ui/icons/svg/*.svg`, `MANIFEST.md` | 9 family icons + `star` |
| `PianoKiosk/SoundPanel.jsx` (+test) | rebuilt per §4 |
| `PianoKiosk/OperatorDrawer.jsx` (+test) | rebuilt per §5 |
| `PianoKiosk/usePianoPreset.js` (+test) | strip unknown keys in `sanitizeSoundPreset` |
| `PianoKiosk/pianoConfigModel.js` (+test) | cap `shortlist.voices` at 16 |
| `PianoKiosk/PianoSheet.jsx` (+test) | deleted |
| `Apps/PianoApp.scss` | delete `.piano-sheet`, `.piano-sound-panel`, `.piano-operator-drawer` |
| `docs/reference/piano/README.md` | chrome paragraph: describe the two full-canvas sheets |
| `data/household/piano/config.yml` | `shortlist:` |

Order of work: shell + primitive first (2, 3, with tests), then families + icons
(4a, 4d), then Sound (4), then Maintenance (5), then the SCSS deletion and the
visual gate last so it runs against the finished sheets.
