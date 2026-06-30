# MIDI Loop Library + Layering Engine — Design

Date: 2026-06-30
Status: validated (brainstorm), implementation starting with CLI tooling

## North star

Turn the newly-acquired MIDI packs into **resources to learn, jam, compose, and
perform — all a few touches away** inside the Piano kiosk. The unifying artifact
is a **shared MIDI loop library** that multiple surfaces draw from, not MIDI
wired into a single mode.

## What the source material actually is

`media/midi/` — 53,810 `.mid` files, ~550 bytes each (short loops, a few bars):

| Pack | Files | Content |
|------|------:|---------|
| `2000_NikoChord_Pack` | 2,400 | Chord progressions; chord symbols in filename (`235_Dm-C-F-Gm-F-Bb.mid`) |
| `Top_100_Melody_Starters` | 2,412 | Melody hooks by mood; scale-degree patterns in name (201 ideas × 12 keys) |
| `FamousMIDI_Bonus` | 3,881 | Famous-song chord/melody snippets (DJ/Classics/TopHits), chords + BPM in name |
| `Niko_MIDI_Pack_` | 45,117 | **Master superset**, re-keyed across 12 keys (9 category groups per key) |

**Critical fact:** ~84% is the Niko pack, which is the same ideas transposed 12×.
The real library is **~4,000 unique ideas, each pre-rendered in all 12 keys.**
MIDI transposition is trivial (shift note numbers), so the 12× is pure redundancy.

## Decisions (locked)

1. **Canonical key, no redundant files.** Collapse the 12 keys → one canonical
   store; transpose live via the roman-numeral abstraction. Originals archived,
   not kept long-term. 53,810 → ~4,000.
2. **Reorganize on disk** into a clean, kebab-case, role-first tree. The clean
   tree *is* the index.
3. **Home = Producer, rebuilt.** The Jam/Loops experience becomes a module inside
   Producer (today's audio-loop Producer is replaced/absorbed as needed).
4. **Full build** (not a thin slice): ingest + theory core + layering engine +
   notation path + Producer rebuild.
5. **Shared theory core in `.mjs`** so both the React UX and the node CLI import
   one implementation (no duplication). `.mjs` is already the repo's proven
   cross-runtime ESM extension (frontend imports `lib/api.mjs`).

## Layered architecture (the spine)

Each layer depends only downward. The loop library/engine **never** parses pitch
or names chords itself — it calls the theory core.

```
SURFACES (React)   CircleOfFifths · ChordStaff · Notation renderers ·
                   falling-notes · Producer Jam browser · Layer mixer
ENGINES (pure)     compatibility-ranker · transpose-to-key ·
                   multitrack MIDI scheduler → voice bridge
PRODUCERS          parseMusicXml · midiToScore(new) · filenameToLoopMeta(new) ·
                   smf read/write (@tonejs/midi)
REPRESENTATIONS    Score model · LoopEntry · Stack   (plain data)
THEORY CORE (.mjs, pure, no DOM)
                   pitch/spell · chordSymbol(parse) · identifyChord ·
                   romanAnalysis(new) · detectKey · transpose · circle-of-fifths
```

### Existing pieces to reuse / consolidate
- `frontend/src/modules/Piano/theory/chordNaming.js` → `identifyChord(midiNotes)`
- `frontend/src/modules/Piano/theory/circleOfFifths.js` → geometry + `activeSlots`
- `frontend/src/modules/MusicNotation/` — **Score model is the seam**
  (`{ divisions, tempo, timeSig, key, parts:[{ notes:[{onset-quarter-beats, midi}] }] }`);
  renderers (abc/svg/musicxml/chord) all consume it.
- **Duplicate to collapse:** `PianoKiosk/modes/Videos/chordName.js` vs
  `theory/chordNaming.js` — one chord namer.

### New theory primitive: roman-numeral analysis
`romanAnalysis(chords, key)`: `Dm-C-F-Gm` in F → `i-bVII-IV-v`. Needed by BOTH the
key-agnostic loop matcher AND the circle-of-fifths teaching UX. Build once.

## Notation / "play-this" path
Convert **MIDI → Score model directly** (`midiToScore.mjs`), NOT MIDI → MusicXML →
model. Skips lossy transcription; reuses the whole notation pipeline (hand split,
key detect, all renderers). MusicXML stays an **optional export** from the model
(print / round-trip), never the display path.

## Layering engine (the centerpiece)
Because everything is canonical MIDI, key & BPM are never blockers — any loop
conforms to the base's key/tempo for free. "Compatibility" = surfacing what sounds
good *stacked*, by **role** (chord beds · basslines · melodies · arps), then
auto-conforming.

Flow: pick a base → library re-ranks every loop against it (harmonic fit via
scale-degrees vs base chords; mood/mode coherence; role complement; same-source
affinity) → toggle layers → play along on the keyboard over the stack. Each layer
can get its own voice via the existing voice bridge.

Player = small multitrack MIDI scheduler (N loops, shared transpose + tempo,
per-track mute).

## On-disk reorganized tree
```
media/midi/loops/
  chord-progressions/
    niko/<mood>/dm-c-f-gm.mid          # canonical key only
    famous/<artist>/<song>.mid
    builder/...
  melodies/
    starters/<mood>/catchy-madness-5-6-1.mid
    famous/<artist>/<song>.mid
  basslines/ ...  arps/ ...
  index.yml                            # generated catalog (the queryable layer)
```
- kebab-case, key-independent names; metadata (bpm, dry/wet→`reverb` flag,
  degrees, source, song, artist, original key, roman numerals) lives in `index.yml`.

## CLI tooling (this build's first deliverable)
Convention: `cli/<name>.mjs` thin wrapper + `<name>.lib.mjs` pure logic +
`<name>.test.mjs`; `--write` to persist (dry-run default).

- **Theory core** (`.mjs`, shared): `chordSymbol`, `romanAnalysis`, `transpose`.
- **`filenameToLoopMeta`** — parse pack filenames → structured `LoopEntry`.
- **`midi-ingest` CLI** — read source packs → parse meta → transpose to canonical
  → write clean kebab tree + `index.yml`; dedupe the 12× re-keying.
- **`midiToScore`** — SMF → Score model (notation path).

## Build status (2026-06-30)

**Shipped (worktree `feature/midi-loop-library`), all TDD, 49 tests passing:**
- Shared theory core (`.mjs`, node + frontend): `chords.parseChordSymbol`,
  `transpose` (incl `semitonesToCanonical`), `romanAnalysis`, `midiToScore`.
- Ingest: `cli/midi-ingest/loopMeta.mjs` (filename→metadata, 100% key /
  ~56% chords / ~53% BPM coverage measured on the real tree),
  `cli/midi-ingest/ingestCore.mjs` (canonical signature + dedup-merge + path),
  `cli/midi-ingest.mjs` (walk + SMF read/write via `@tonejs/midi`).
- **Verified empirically:** the 12 pre-rendered keys are true transpositions
  (identical canonical pitch-class signatures). Full dry-run:
  **53,810 → 3,223 unique ideas (94% redundancy removed)** —
  1,655 chord-progressions, 1,154 melodies, 391 ideas, 23 basslines.

**Next:**
- Run `--write` to materialize the canonical tree + `index.yml` (writes ~3,223
  files into `media/midi/loops/`; pending user go-ahead).
- Frontend: re-export `Piano/theory/*.js` from the shared core (dedupe the second
  chord namer); build the layering engine + Producer rebuild + falling-notes.
- Minor parser refinements: bassline slugs (e.g. `c-m-g-m`), idea/famous mood.

## Open / deferred
- Exact voice assignment per role (chord vs bass vs lead) — Producer rebuild stage.
- Whether `index.yml` is one file or sharded by role (decide at ingest scale).
- Falling-notes renderer reuse vs new — notation stage.
```
