# Piano Producer — UX & Taxonomy Overhaul (Design)

> **Status:** IMPLEMENTED 2026-07-04 (branch `feat/piano-producer-ux-overhaul`).
> All phases 1–6 (+2b) shipped; 137 Piano test files / 1441 tests green. See the
> build-order table (§10) for per-phase commits and the follow-ups list below.
> **Supersedes UX of:** [`2026-07-01-piano-producer-overhaul-design.md`](./2026-07-01-piano-producer-overhaul-design.md)
> **Architecture reference:** [`docs/reference/piano/producer.md`](../../reference/piano/producer.md)
>
> This is a **presentation + taxonomy** overhaul. The two-tree state model,
> the pure engine (`shared/music/`), the tiered VoiceRouter, and the capture
> engine (`useLoopCapture`) all stay. Most of this is renaming, re-layout, and
> surfacing machinery that already exists. Phase 6 is the only genuinely new
> engine surface.

---

## 1. Why

The Producer's *concepts* are sound (jam-first, two-tree workspace/draft,
consonance-gated library, overdub capture) but the **names and spatial
hierarchy leak**, so the screen reads as a hodgepodge:

- "Mix" and "Song" are floating pills, not clearly nested levels.
- The beat counter climbs forever (`39:3`) — no sense of a bounded loop.
- The transport bar has 7 controls fighting for space (`−BPM+ · TAP · −Key+ · Click`).
- The channel strip scatters identity across its width and litters it with
  unlabeled glyphs (`⇉`, `✕`).
- Recording is a separate door from "+ Add layer," and you can't *see* your
  playing land in real time.
- No granular drum-loop or chord-progression builders — the library + live
  recording are the only ways in, and perfect library matches get rarer as a
  stack grows.

---

## 2. Taxonomy (the root fix)

There are **two levels**, and "mix" is not one of them — mixing is an
*activity*, not a place.

| Term | Meaning | Replaces |
|---|---|---|
| **Loop** | The repeating N-bar cycle you build & save. *The* atomic unit. | "Mix" / "stack" / "jam" (as nouns) |
| **Layer** | One row inside a Loop: a part on a channel, with a voice + gain/mute/solo | — |
| **Part / role** | What a layer *does*: **Chords · Bass · Drums · Melody** | — |
| **Voice** | The instrument sound a layer plays (Grand Piano, etc.) | — |
| **Section** | A Loop placed into a Song as a named piece (Verse/A) | — |
| **Song** | Sections arranged in time | — |
| **My Loops** | Your saved personal loops | **"Crate"** |
| **Presets** | Pre-built starter Loops | "Prefabs" |
| **Library** | The shared browsable pool of loops | — |
| **Carry** | Keep a layer running across sections | the bare **⇉** glyph |

`mixing` and `jamming` are **verbs**, never tabs. You never need a generic noun
for a library item — you **"Add a layer"** and choose **Chords / Bass / Drums /
Melody**, so "loop" always means *the cycle*.

**Role color system** (threads through the entire UI — strips, Add Layer cards,
section-card glyphs, builder outputs): **Chords 🟪 · Bass 🟧 · Drums 🟥 · Melody 🟦.**
Echoes the GarageBand "Add Loop" category colors. This single move does much of
the "make it cohere" work.

---

## 3. Navigation & information architecture

Replace the floating pills with a **segmented control** anchored top-left of the
stage, plus a **context breadcrumb** that keeps the nesting explicit.

```
┌───────────────────────────────────────────────────────────┐
│ ≡ › Producer          Song: "Summer Jam"    Dad · Grand ▾ │  header
├───────────────────────────────────────────────────────────┤
│ ⟨ Loop │ Song ⟩          Verse ▸ editing         🔔  🔴   │  tab + breadcrumb + click + rec
├───────────────────────────────────────────────────────────┤
│  1 / 8 bars ↻     120 BPM     Key D              [layers…] │  loop transport + strips
└───────────────────────────────────────────────────────────┘
```

- **Loop tab** = the working surface (layers, transport, piano). 90% of time.
- **Song tab** = zoom out: sections as cards, each rendered as a *mini-loop*
  (its layer glyphs stacked), in play order.
- Tapping a section card **auto-switches to Loop** with that section loaded; the
  breadcrumb becomes `Song "Summer Jam" › Verse`. You literally see a section
  *is* a loop — you drop into it.
- **Free-jamming** (no song yet): breadcrumb reads `Loop · scratch`; the Song
  tab shows a "Start a song" empty state. Nothing forces a song.
- **"Add to Song"** in the Loop level promotes the current loop to a new section.

The subset relationship is carried by the **breadcrumb** and by section cards
rendering as mini-loops — not by tab labels alone. (Play mode stays sticky: what
Play starts depends on the active tab at play time, then locks until stop.)

---

## 4. The Loop as a bounded, cycling thing

**Every Loop has an explicit length in bars.** A segmented control —
**2 · 4 · 8 · 16** — sets it, defaulting to the base harmonic layer's natural
length (`loopBars()`). Length is **live and re-fittable**: shrinking 8→4
truncates layers at the new boundary; shorter layers repeat inside it. This is
what `buildSectionCycle`'s forced `lengthBars` already does for sections —
surfaced live in the workspace.

**The counter cycles and resets.** A **loop meter** (one segment per bar) spans
the top of the Loop tab; the current bar lights, a playhead sweeps smoothly, and
**at the boundary it snaps back to bar 1.**

```
   ▐▐ ← playhead sweeps
  ┌──┬──┬──┬──┬──┬──┬──┬──┐
  │ 1│ 2│▓3│ 4│ 5│ 6│ 7│ 8│   ← 8-bar loop meter, bar 3 lit
  └──┴──┴──┴──┴──┴──┴──┴──┘
        3 : 2  ·  8 bars          ← bar:beat within the loop, resets to 1:1
```

Readout is `bar:beat` (`3:2`) **within** the loop, with `· 8 bars` for context;
counts `1:1 → 8:4` then resets. The meter also hosts the record count-in and
capture cycle visualization. Loop length lives on workspace state and carries
into the section on "Add to Song."

**Change from today:** `TransportBar` currently renders `barLabel = pos.bar + 1`
(ever-climbing). New behavior wraps bar within `lengthBars`.

---

## 5. Transport consolidation

Keep only what you touch every few seconds on the bar; move adjustable-but-
occasional controls into tap-to-open sheets.

```
  ◼ Stop     ▐ 3:2 · 8 bars ▐     120 BPM     Key D     🔔     🔴
   play      loop meter+readout    chip→sheet  chip→sheet  click  rec
```

**Tempo sheet** (tap BPM chip) — from the myLoops tempo dial:

```
        ╭─────────╮
        │   120   │   ← big, tappable/draggable
        │  Tempo  │
        ╰─────────╯
   [ TAP ]   − / +  fine
   Presets:  72 · 90 · 110 · 120 · 140
   Count-in: 1 bar ▾
```
Tap-tempo folds in here. (Metronome/**Click** stays as a **small persistent
toggle on the bar** — reachable in one tap during rehearsal/recording.)

**Key sheet** (tap Key chip) — a compact **circle of fifths** (also teaches kids
where keys sit):

```
        C
    F       G
  Bb    ●D    A      ← tap a wedge to set tonic
   Eb        E
      Ab  Db  B
   [ Major | minor ]
```

Both sheets are big-target modal overlays (kiosk rule: discrete taps, no tiny
steppers on the main bar). Chips show live state; sheets are only for changing it.

---

## 6. Channel strip re-layout

Three clean zones: **who am I** (left) · **what am I playing** (center) ·
**mix me** (right).

```
┌──────────────┬───────────────────────────────────┬──────────────────┐
│ ▛▟ Grand Pf ▾│  D   Dsus4   D   Dsus4  …          │ M  S   ▁▂▃ 100% ⋯│
│ 🟪 Chords    │  ▐ sweeping cursor                 │                  │
└──────────────┴───────────────────────────────────┴──────────────────┘
```

- **Left — identity cluster:** identicon + **voice name** (tap → VoicePicker) +
  **role** label, stacked and role-colored. Grooves show the **kit name** here
  (tappable → kit picker). *This is the "instrument goes with the identicon" fix.*
- **Center — live content:** the chord lane or piano-roll with sweeping cursor —
  the widest zone. **Chord lane now shows keyed names** (see §7).
- **Right — mixer:** **M · S · gain chip**, always visible. Then a **⋯ overflow**
  with named, wordy actions: **Carry across sections · Keep to My Loops ·
  Remove.** No more bare `⇉` / `✕`. **Remove** lives in the overflow (still
  2-tap-confirmed) to reduce accidental kiosk deletes.

---

## 7. Keyed chord names in the ChordLane

When a loop is imported into the Producer it is **keyed to the jam**
(`toTransportLayers` transposes by `keyShift − tonicPc`, so its `I` sounds at the
session tonic). The ChordLane must therefore show the **concrete keyed name**
together with the Roman numeral:

```
   D      Dsus4    D      Dsus4        ← keyed name (primary)
   I      Isus4    I      Isus4        ← Roman (sub-label)
```

- Session tonic that Roman `I` maps to = `((keyShift % 12) + 12) % 12` (matches
  the audio; verify agreement with the displayed key label for a non-C base
  brick — audio is source of truth if they diverge).
- New pure helper: `(romanToken, sessionTonicPc) → "Dsus4"` — parse degree +
  quality/figure (reuse `parseRoman`), transpose the degree onto the session
  tonic, spell root + suffix. Lives with `shared/music/` or the roman component.
- Applies **only in the keyed Producer context**; the abstract LibraryBrowser
  cards stay Roman-only.
- Layout: keyed name prominent, Roman as a small sub-label beneath, lit + swept
  exactly as today.

---

## 8. Recording overhaul — record *is* a way to add a layer

The capture engine already does everything (multi-pass overdub, hear-yourself,
`undoPass` / `clearTake` / `keep`, count-in, cycling). Two gaps, both UX:

1. No live piano-roll — `CaptureCard` shows a bar dial + pass counter only.
2. Recording is a separate door from "+ Add layer."

**Entry point.** Retire the standalone record door. **"+ Add layer"** opens one
**Add Layer sheet** (the GarageBand "Add Loop" pattern):

```
   Add a layer
   ┌─────────┬─────────┬─────────┬─────────┐
   │🟪 Chords│🟧 Bass  │🟥 Drums │🟦 Melody│   ← browse library by role
   └─────────┴─────────┴─────────┴─────────┘
   [ ♫ Library    |    ♥ My Loops ]            ← source toggle
   ┌───────────────────────────────────────┐
   │  🎙  Record a new layer                │
   ├───────────────────────────────────────┤
   │  🥁 Build a drum loop                  │   ← §9
   │  🎹 Build chords                       │   ← §9
   └───────────────────────────────────────┘
```

**Record overlay.** The loop keeps playing (you hear it), Click on, count-in,
then a **big live piano-roll fills in real time** as you play, cycling with the
loop — the star of the screen:

```
   ● REC   Verse · 8 bars      bar 3 / 8    ▐▐
   ┌───────────────────────────────────────┐
   │  ▬▬        ▬▬▬                         │  ← your notes land live,
   │      ▬▬          ▬▬     ▬▬             │    thickening each pass
   └───────────────────────────────────────┘
   [ ↶ Undo pass ]  [ ✕ Clear ]  [ ✓ Keep ]
```

- **Undo pass** drops the last lap; **Clear** wipes the take; keep playing to
  **thicken** (overdub); **Keep** commits.
- On Keep → becomes a **layer** immediately, then asks: **Save to My Loops** or
  **keep just for now** (ephemeral).
- Role auto-inferred (drums vs harmonic/melodic), one-tap correctable (engine
  already does this).
- One session = one layer, built over as many passes as you like. (Overdubbing
  onto an *existing* layer is future.)

---

## 9. Builder modules (both functional)

Additional sources in the Add Layer sheet — the **manual, precise alternative**
to browsing the library, for when nothing in the library fits.

### 🥁 Build a drum loop — step sequencer

Grid: rows = drum pieces, columns = 16th steps across the loop's bars.

```
        1 · · · 2 · · · 3 · · · 4 · · ·
  Kick  ●·······●·······●·······●·······
  Snare ····●·······●·······●·······●···
  HiHat ●·●·●·●·●·●·●·●·●·●·●·●·●·●·●·●·●·
  Clap  ················●···············
        [ Kit: Rude ▾ ]     ▐ playhead
```

- Tap cells to toggle hits; plays in sync with the loop; kit swappable.
- Output = a **Drums layer** on channel 9 — feeds the existing groove/percussion
  path (`percussion.mjs`, drum-map, `drumMode`).
- Length follows the loop length (§4).

### 🎹 Build chords — progression builder

Key-aware, tap-to-build. One slot per bar; tap a slot, pick from a palette where
**diatonic chords glow** and good **next-chord** suggestions brighten (Chords
Explorer / circle-of-fifths inspiration).

```
  Key D   │ I │ V │ vi│ IV│      ← the progression being built
          │ D │ A │Bm │ G │
  palette: D  Em  F#m  G  A  Bm … (diatonic lit) + sus/7/9 modifiers
```

- Output = a **Chords layer** with a real timeline + Roman + keyed names —
  immediately ChordLane-compatible (§7).
- Reuses `romanAnalysis` / `chords.mjs` / `harmonicTimeline` for spelling and
  timeline generation; the diatonic-glow + next-chord suggestion is new logic.

---

## 10. Build order

| Phase | Scope | Risk |
|---|---|---|
| **1 · Taxonomy & shell** | Rename Mix→Loop, Crate→My Loops, ⇉→Carry; segmented Loop\|Song tabs + breadcrumb; role-color system | Low |
| **2 · Bounded loop** | Length control (2/4/8/16), cycling bar:beat, loop meter w/ reset | Low-med |
| **3 · Transport consolidation** | Tempo sheet + Key circle-of-fifths sheet; Click small toggle; keyed chord names in ChordLane | Med |
| **4 · Channel strip** | Left identity cluster, center content, right mixer + ⋯ overflow | Low-med |
| **5 · Recording** | Unified Add Layer sheet; live piano-roll; Keep → Save/ephemeral | Med |
| **6 · Builders** | Drum step-sequencer (functional) + chord progression builder (functional) | High |

Phases 1–4 are mostly presentation over existing machinery; 5 reuses the capture
engine; 6 is the new build. Each phase is independently shippable and leaves the
Producer coherent. Every phase must ship with structured logging
(`frontend/src/lib/logging/`) at lifecycle/state-transition points.

**All phases shipped 2026-07-04**, each as its own commit on
`feat/piano-producer-ux-overhaul` (1 · taxonomy/shell → 2 · bounded loop →
2b · settable length → 3 · transport sheets + keyed names → 4 · strip re-layout →
5 · Add Layer sheet + live record roll → 6 · builders).

### Follow-ups deferred from this pass

- **Keyed names for built/recorded chord layers:** the ChannelStrip shows the
  keyed ChordLane only for library entries (`entry.roman`); take-sourced layers
  (recorded or ChordBuilder output) render as a piano-roll. Attaching a roman/
  timeline read-out to take layers would give them the same chord lane.
- **Builder live audio preview:** the drum sequencer / chord builder commit a
  layer that plays in the mix, but don't audition inside the modal. A preview
  transport would let you hear before adding.
- **Keep → Save/ephemeral prompt:** after a recorded Keep the take lands as an
  ephemeral layer; "Save to My Loops" lives on the strip's ⋯ menu rather than an
  immediate post-Keep choice.
- **My Loops source in the Add Layer sheet:** the design's Library/My Loops
  toggle isn't surfaced there yet (role cards open the shared library; the
  LibraryBrowser's own `Ours` facet still reaches saved loops).
- **Internal `mix` token / `__mix` CSS:** the workspace tab is labelled "Loop"
  but the state token and class names stay `mix` (invisible; a later mechanical
  rename can align them).

---

## 11. Open items / to verify during implementation

- **Keyed-name vs displayed-key agreement:** confirm the `keyLabel`
  (`KEY_PC[detectedKey] + keyShift`) matches the audio tonic (`keyShift`) for a
  non-C base brick; reconcile if they diverge (audio wins). May intersect the
  `harmony-key` work on the `design/self-indexing-loops` branch.
- **Loop length across mixed-length layers:** confirm the LCM/forced-length
  behavior is what we want when e.g. a 4-bar bass sits under an 8-bar chord loop.
- **Circle-of-fifths key sheet:** decide relative major/minor handling vs the
  existing keyShift model (which is absolute-semitone).
- **Chord builder engine reuse:** validate `harmonicTimeline` can synthesize a
  timeline from a tapped progression (it currently *analyzes* notes).
