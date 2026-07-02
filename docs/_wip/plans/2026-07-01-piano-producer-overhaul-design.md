# Piano Producer Overhaul — Design

**Date:** 2026-07-01
**Status:** Validated design (brainstormed + approved section-by-section)
**Requirements:** `2026-07-01-piano-producer-song-builder-requirements.md`
**Scope:** Full rewrite of `frontend/src/modules/Piano/PianoKiosk/modes/Producer/`
plus supporting engine (`shared/music/`), backend API, CLI enrichment, and
percussion library seeding.

---

## Decisions made during brainstorming

| Decision | Choice |
|---|---|
| Rewrite vs extend | **Full rewrite** around a jam-first workspace model |
| Save ownership | **Household pool, tagged by author** (via current-player context) |
| Drum sound source | **Tiered**: onboard Roland GM ch-10 → browser GM synth → APK SFZ (priority order per KC) |
| Per-layer instruments | **Day one** — bass/guitar/strings/piano layered together, via the same tier model (GM channels) |
| Groove recording | **In v1**, plus seed library from imported drum-MIDI packs (drum-patterns.com or similar) |
| Own-loop recording | **In v1** for all kinds (groove/harmonic/melodic) — it is a front door to the jam, not a bolt-on |
| Harmonic guardrails | **Union-consonance nesting function** over enriched per-slot pitch data, not label matching |
| Browsing | First-class entry point; library stocked at every altitude (loops, stacks, sections, structures, example songs) |

## Guiding principle (from the "manufacturing" conversation)

Loose conveyance, not a locked pipeline. Stages — jam (mine/mold), Crate
(bins/warehouse), song builder (assembly), saved song (package/ship) — are all
valid final destinations. The conveyor only moves when the person pushes
something down it. Nobody faces a blank page unless they want one.

---

## 1. Core model & state

Two state trees, deliberately unequal:

**`workspace`** (always exists, in-memory reducer) — "what's live right now":

```
{
  layers: [{ id, source: loopRef|takeRef, channel, gmProgram, gain, muted, soloed, carried }],
  keyShift, bpm, metronome, transportStatus,
  editingSectionId: null | id   // null = free jam
}
```

Every jam action mutates only this. No song, no title, no hidden section-1-of-1.

**`draft`** (starts `null`) — materializes on first promotion or when loading a
saved/example song:

```
{
  sections: [{ id, name, lengthBars, stack }],   // stacks are COPIES (independence by default)
  arrangement: [{ sectionId, repeats }],
  meta: { title?, author, key, bpm }
}
```

A layer marked **carried** is referenced (not copied) across sections so a
groove or bass voice persists while harmony changes (§4.1 continuity).
Song-level key/tempo live in the draft once it exists; workspace inherits them.

**Verbs between the trees** (small, explicit): `promote` (current stack → new or
updated section), `open` (section → workspace for editing), `slot` (Crate item →
empty structure slot), `crystallize` (draft → saved song). Loaded prepackaged
songs are just drafts whose sections you `open` — remixing an example uses the
same verbs as building from scratch.

**Identity:** every loop / stack / section / song gets a deterministic glyph +
seeded color, generated **locally as SVG** (no network), from its content
signature — roman signature (harmonic), degree contour (melodic), onset pattern
(groove). Same material → same picture forever. Human titles shown when they
exist; never fabricated (§3.1).

## 2. Sound & voice routing

Everything speaks **General MIDI**: each layer gets a MIDI channel + GM program;
percussion is channel 10 with the standard drum map. A new **`VoiceRouter`**
replaces direct `pressNote` for loop playback, taking `(channel, note, velocity)`
and delivering to the best available tier:

1. **Onboard Roland via Jamcorder** — if the MDG-400 is multi-timbral GM.
   **Day-one verification spike** (send ch-10 drums + ch-2 program-change over
   BLE, listen). Result recorded as a capability flag in piano config.
2. **Browser GM synth** (WebAudioFont or equivalent, in the WebView) — the
   guaranteed tier: 128 GM programs + drum kit + per-channel gain. Also the
   metronome's home. Needs a latency/polyphony spike on the SM-T590.
3. **APK multi-channel sfizz** — future native tier; router interface designed
   so it drops in without touching Producer.

Routing is **per-channel**, not all-or-nothing (piano-role layers → real piano
while strings + drums render in tier 2). Default policy: best tier per channel.

- The user's own playing is untouched — existing piano voice path as today.
- Keyboard visualization: harmonic/bass layers feed `loopNotes` so the backing
  visibly plays the piano (§5); percussion and dense melodic layers don't.
- Per-layer **gain** is honored natively by tiers 2/3, approximated by velocity
  scaling on tier 1.

## 3. Playback engine

New **`shared/music/arrangementScheduler.mjs`** (pure, tested) layered on
`buildLoopCycle`:

- **Stack playback** (free jam): one phase-aligned looping cycle; events carry
  `channel` and gain-scaled `velocity`. **Bar-aligned mutation**: layer
  add/remove applies at the next bar boundary (today's restart-on-change is
  clunky for jamming).
- **Section playback**: a stack with fixed `lengthBars`; layers tile/truncate to
  exactly that span.
- **Arrangement playback**: compiled sequence of `(section × repeats)` blocks;
  transport walks blocks with section-boundary callbacks (active-slot highlight,
  auto-advance). Whole-song loop toggle.
- **Live override** (scene-launch model): "play section X next" queues a jump at
  the current block's next repeat boundary (tap-and-hold = next bar). Written
  arrangement and hands-on jam are the same engine fed by a queue.

React side: **`useProducerTransport`** keeps the proven rAF wall-clock pattern
from `useLoopTransport`, emits through VoiceRouter, exposes `positionRef`
(bar/beat + normalized) for playhead, metronome flash, count-ins.

**Metronome** is engine-level: a ch-10 tick pattern the scheduler runs alone
(blank-page recording) or overlays on anything.

Recording capture consumes the same clock, so quantization is exact.

## 4. Library, identity & discovery

One **catalog** facade over three stores, merged in one browse surface:

- **Curated loops** — existing ~3,223-entry `index.yml` + new `percussion/`
  family: imported drum-MIDI packs ingested via extended `cli/midi-ingest.mjs`
  (recognizes GM drum-map files; tags `kind: groove`, `feel`
  straight/swing/shuffle, genre, bpm; no roman, no key). Seed set before
  launch: rock, pop, waltz, latin, brush.
- **Household Crate** — everything anyone kept (recorded loops, stacks,
  sections), author-tagged, served by the new API. Appears in browse under an
  "Ours" facet.
- **Prefabs** — curated stacks, sections, structure templates (bar-count
  skeletons), and complete example songs. Authored as YAML in the media tree;
  growing the collection never needs a code change.

**Compatibility is kind-aware** (§2.4): harmonic↔harmonic via union-consonance
(below); grooves match on tempo/feel only and are offered everywhere;
melody-over-harmony gets a **degree-profile fit** scorer (emphasized melody
degrees landing on the harmony's chord tones rank high) — musical, not mere
same-key filtering. "Goes with this →" is a first-class browse pivot from any
loop, in or out of the workspace.

### 4b. Harmonic compatibility: union-consonance, not label matching

Compatibility is **directional and nesting**; labels can't express it. Work on
actual sounding pitch content, slot by slot:

**Enrichment pass** (new CLI, batch, re-runnable): every harmonic/bass/melodic
loop gets a computed **harmonic timeline** — per beat-slot pitch-class set
(relative to canonical root) — plus derived roman, root, mode, and a
**specificity grade**: root-only `{0}` → open fifth `{0,7}` → triad →
7th/9th/altered. Runs over all curated loops and every import; ambiguous
analyses get **flagged for hygiene review**, not guessed. Stored in the index →
runtime checks are pure set math.

**`stackable(A, B)`:** phase-align the two timelines (same alignment as the
scheduler); for each overlapping slot take the **union** of pitch classes; the
pair is stackable iff every slot's union still spells a consonant, nameable
chord quality on the shared root. Produces the required nesting:
octaves-on-root over anything sharing the root ✓; fifth under a seventh ✓
(union = the seventh chord); dim7 over sus2 ✗ (union spells nothing).
**Score = worst slot, not average** — one clashing bar disqualifies.

Key stays trivial (auto-transpose to conform); tempo stays trivial (runtime).
After a base is picked, `stackable` is the hard guardrail; ranking within the
compatible set still uses mood/feel/complement scoring. Recording over the
guardrails is always allowed — play what you want on top.

## 5. Recording your own loops

One **capture engine**, three entrances: blank page (metronome only), overdub
onto the playing jam, or fill an empty structure slot. DAW-loop-style, never
one-shot:

- **Arm & cycle:** pick loop length (2/4/8 bars or "match what's playing"),
  count-in, cycle keeps rolling. Played notes land in the current **pass**; at
  each cycle boundary the pass merges into the take and looping continues — you
  hear yourself immediately and keep thickening.
- **Pass-level control:** *undo last pass* / *clear take* / *keep* — three big
  touch buttons. Keeping doesn't stop the music; the loop becomes a workspace
  layer like any other.
- **Timing:** captured against the engine clock → exact bar alignment.
  Snap-to-grid toggle (off / light 1/16) — grooves want it, expressive playing
  doesn't.
- **Drum mode:** recording a groove maps the keyboard (physical + on-screen) to
  GM drum pads (labeled kick/snare/hats/toms/crash octave) plus big on-screen
  finger pads. Output on ch 10.
- **Touch editing, deliberately minimal:** piano-roll *viewer*; tap note →
  select → delete / velocity nudge. Anything deeper: re-record the pass.
- **Citizenship:** take gets kind-inferred (ch-10 → groove; else poly/mono →
  harmonic/melodic, one-tap confirmable), runs through the same client-side
  harmonic-timeline analysis, gets its glyph, can be kept to the Crate.

## 6. Persistence & API

**Files (household pool, author-tagged)** — new `producer/` area in the
household data tree:

- `…/piano/producer/loops/{id}.yml` — recorded loops: note events (YAML-embedded,
  like Studio takes) + kind, harmonic timeline, author, created.
- `…/piano/producer/crate/{id}.yml` — kept stacks/sections: layer refs (library
  loops by slug, recorded loops by id) + voices, gains, lengthBars.
- `…/piano/producer/songs/{id}.yml` — crystallized songs: sections, arrangement,
  key/tempo, meta (title optional — glyph identity applies to songs too).

Curated **prefabs** live read-only in the media tree next to the loop index,
same YAML shapes — one merged listing where the only difference is which items
have a Delete button.

**API:** extend the piano router:
`GET/POST/PATCH/DELETE /api/v1/piano/producer/{loops|crate|songs}`, mirroring
Studio recordings conventions. Author id from current-player context. Listings
are light (identity, kind, timeline signature); note payloads load on demand.

**Lazy safety net:** workspace (+ draft) snapshots to `localStorage` every few
bars while playing. Next visit offers one quiet "Resume where things left off?"
chip — never a blocker, cleared by starting anything new. Proper saving stays
an explicit act.

**Enrichment artifacts** (harmonic timelines for curated loops) are written back
into the served index by the CLI pass — the frontend never computes them for
curated material.

## 7. UI (touch-first DAW)

Landscape tablet. Performance surfaces have three bands: **transport bar**
(top), **stage** (middle), **piano keyboard** (bottom, always live).

**Stated principle: every surface earns its pixels.** At each lifecycle moment,
chrome that doesn't serve the current intent (transport while browsing,
keyboard while arranging) collapses away and returns when performance resumes.

**Transport bar** — play/stop, bar:beat readout, BPM stepper + tap-tempo pad,
key stepper with current-key label, metronome toggle, record arm. Discrete
taps, no drags.

**Stage views** (tab-switched, state preserved):

- **Mix** (jam home): DAW-style horizontal **channel strips** — glyph +
  roman/contour identity, voice chip (tap → GM voice picker by family),
  latching **M**/**S**, segmented tap-to-set **gain strip** using the
  `TouchVolumeButtons` pattern (log curve included). `+` strip opens the
  library pre-filtered to stackable.
- **Song**: the structure rail — slot cards in sequence
  (`Intro ×1 · 8 bars`, `Verse ×2 · 16`…), each showing its section's glyph
  stack. Tap slot → fill (Crate / prefab / current jam) or open into Mix;
  long-press → repeats/bars steppers. Active slot glows during playback and
  auto-advances; tapping another queues it (scene launch). Empty state offers
  structure templates.

**Library and other deep-scroll surfaces go full-bleed** — full-screen (or
drawer when shallow), reclaiming transport + keyboard rows. Facets/search
pinned top; compact "now playing" pill floats (the jam keeps looping
underneath); Close/Add bar at bottom. Same treatment: Crate, GM voice picker,
structure templates, saved-song loading.

**Press-to-peek audition:** on any card, **press-and-hold = hear it** (over the
current stack if playing, solo + metronome if not; auto-conformed to current
key/tempo so the audition is honest); **release = silence**. Tap = add to
stage. Replaces the tap-▶ toggle preview.

**Recording** drops a **capture card** over any view: count-in, cycling bar
dial, the three pass buttons.

Visual language: existing kiosk aesthetic — Roboto Condensed (canon), dark
stage, bold color from glyph seeds, ≥48px touch targets. Frontend-design pass
at implementation time. DAW-grade mixer components throughout, tap-first.

## 8. Testing & rollout

**Engine (pure, TDD):** `shared/music` additions — harmonic-timeline
extraction, `stackable()` union-consonance (fixture table incl.
octave-over-shared-root ✓, fifth-under-seventh ✓, dim7-over-sus2 ✗),
arrangement compilation, live-jump queueing, melody-over-harmony fit — plain
`.test.mjs` alongside.

**Enrichment CLI:** run over the full curated index; report distribution
(analyzed / ambiguous / failed) to size the real hygiene burden before trusting
guardrails.

**Frontend:** reducer tests for workspace/draft/verbs; component tests for
channel strip, capture card, structure rail (existing kiosk test style);
Playwright flow — browse → stack → promote → arrange → save → reload.

**Hardware spikes, day one:**
1. MDG-400 GM multi-timbral + ch-10 drums through the Jamcorder → capability
   flag in config.
2. WebAudioFont (or equivalent) inside FKB WebView on SM-T590 → latency +
   polyphony check for the guaranteed tier.

**Rollout order:** engine + enrichment → VoiceRouter + tiers → workspace/Mix
rewrite (jam must be excellent before anything else lands) → library
full-screen + percussion seeding → recording → sections/arrangement →
persistence + Crate → prefabs & example songs.
