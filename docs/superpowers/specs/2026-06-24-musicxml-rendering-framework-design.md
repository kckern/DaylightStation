# MusicXML Rendering Framework — Foundation Design

**Date:** 2026-06-24
**Status:** Approved design (engine + architecture confirmed), ready for planning
**Scope:** `frontend/src/modules/MusicNotation/` (extend the existing module)
**Seed fixture:** `media/docs/sheet-music/maryhadalittlelamb.musicxml` (grand staff, C major, 4/4, quarter/half notes, 8 bars — a simple-but-real first score)

## Goal

Build the **foundation** of a web-native MusicXML notation framework: parse a MusicXML score into a renderer-agnostic model and engrave it as SVG. Lessons and sheet music arrive as MusicXML; today it would render to PDF. We want it web-native (SVG), and eventually dynamic — playback follow-along, and switchable layout (horizontal infinite-scroll, vertical wrapped pagination, page turns). This spec covers **phase 1**: a correct *static* grand-staff render of the seed, with the dynamic layer designed in as clean seams (built in later increments). Target robustness: ~80% of real-world notation; the obscure 20% (codas, ottava brackets, exotic time signatures, etc.) is explicitly deferred.

## Engine decision

**VexFlow as the low-level glyph/beam engine; we own the framework on top.** VexFlow draws the thankless part — noteheads, stems, beams, accidentals, ties — as SVG. We own the MusicXML parser, the score model, the layout, and (phase 2) the viewport and playback cursor. This matches the stated lean: lean on a library for the hard primitives, build our own framework for the parts that matter. (Rejected: hand-rolling the engraver — months of solved-problem work; wrapping OSMD — wholesale reuse that owns layout and would fight our scroll/page-turn modes; MusicXML→ABC→abcjs — ABC can't represent all MusicXML, capping fidelity below 80%.)

VexFlow is a new dependency (`vexflow`, v4). abcjs (already installed) stays the engine for the live MIDI staves (`AbcRenderer`, `SvgStaffRenderer`); this framework is the separate `'musicxml'` path.

## Architecture

A **renderer-agnostic Score model** sits in the middle: MusicXML quirks stop at the parser, drawing quirks stop at the VexFlow renderer. Layout, scroll, and playback all work against the clean model + computed positions — so VexFlow could later be swapped, or a canvas renderer added, without touching the rest.

### Phase 1 — units (build now)

1. **Parser** — `parseMusicXml(xmlString) → Score`. Pure function. MusicXML DOM → the Score model. Handles the foundation subset (below). No drawing, no VexFlow.
2. **Score model** — the intermediate representation (IR). Plain data, renderer-agnostic. The decoupling seam. Shape:
   ```
   Score   = { divisions, parts: Part[] }
   Part    = { id, name, staves: number, measures: Measure[] }
   Measure = { number, attributes?: Attributes, voices: Note[][] }   // voices[v] is a time-ordered list
   Attributes = { clefs: {staff,sign,line}[], key: {fifths}, time: {beats,beatType} }   // present when they change
   Note    = { staff, voice, pitch?: {step,octave,alter}, rest?: boolean, duration, type, dots, chord?: boolean, beam?, tie? }
   ```
   `pitch` absent ⇒ rest. `chord:true` ⇒ stacked on the previous note (same onset). `duration` is in MusicXML divisions; `type` is the visual note value (quarter/half/…).
3. **Layout** — `layoutScore(score, { width }) → System[]`. Groups measures into **systems** (lines), computes each system's measure widths and the grand-staff stacking (treble over bass with a brace + barline connector). Owns "where each bar goes." Exposes, per system, the data the viewport and cursor consume (measure x-ranges; a `beat → {systemIndex, x}` map). Phase-1 layout default: **vertical wrapped systems** in a scroll container (a normal page).
4. **VexFlow renderer** — `renderSystem(system, svgContext)` adapter. Maps the model+layout to VexFlow `Stave`/`StaveNote`/`Voice`/`Formatter`/`Beam`/`StaveConnector` and draws into an SVG context. The only file that imports VexFlow.
5. **`<MusicXmlRenderer>`** — the React facade, filling the existing seam in `modules/MusicNotation` (replacing the placeholder). Props: `{ musicXml: string }` (raw document). Orchestrates parse → layout → render into a sized, scrollable SVG. Reachable via `<Notation renderer="musicxml" musicXml={…} />`; used by Lessons and Sheet Music.

### Phase 2+ — seams (designed now, built later)

- **Viewport** — a wrapper that switches how layout flows: vertical-wrapped (phase 1 default) · horizontal infinite-scroll · page-turn. It re-runs `layoutScore` with different constraints and arranges the rendered systems; it consumes layout output, never the parser.
- **Playback cursor** — layout exposes the `beat → {systemIndex, x}` map; a clock (or the live MIDI stream the games already grade against) drives a highlight overlay + auto-scroll. No parser/renderer changes required.

## Foundation coverage subset (the ~80% boundary)

**MUST (the seed needs these) — phase 1:**
- One part, **multi-staff grand staff** (`<staves>2`), G (treble) and F (bass) clefs.
- Key signature (`<fifths>`), time signature (`<beats>/<beat-type>`), `<divisions>`.
- Notes: `<pitch>` (step/octave/alter), `<duration>`, `<type>`; `<measure>`; `<backup>` (multi-staff timing within a measure).

**SHOULD (common; include in phase 1 if cheap, else the very next increment):**
- Rests, dotted notes, accidentals, beams, chords (`<chord>`), ties, a second voice per staff.

**DEFER (the obscure ~20%) — explicitly out of scope:**
- Codas/segnos, ottava (8va/8vb) brackets, tuplets, grace notes, irregular/compound-meter edge cases, repeats/voltas/endings, lyrics, dynamics/articulations/ornaments, cross-staff beaming, multiple parts/instruments, tablature, percussion clefs, page/credit/layout directives.

The parser and model are designed so SHOULD/DEFER items are added without restructuring (unknown elements are skipped, not fatal).

## Integration & dev fixture

- Extend `frontend/src/modules/MusicNotation/`: add `parseMusicXml.js` (+ model types), `layout.js`, `renderers/vexflowRender.js`, and flesh out `renderers/MusicXmlRenderer.jsx`. Export the parser/layout from `index.js`.
- Add `vexflow` to `frontend/package.json`.
- Copy the seed into the repo as a hermetic test fixture: `frontend/src/modules/MusicNotation/__fixtures__/maryhadalittlelamb.musicxml`. (Production scores will be fetched elsewhere — Plex/lesson files — which is out of scope for the foundation; the `<MusicXmlRenderer>` simply takes a `musicXml` string.)

## Testing

- **Parser** (pure, highest value): parse the seed → assert the model: 8 measures, `staves:2`, clefs G@line2 & F@line4, key `fifths:0`, time `4/4`, and the first measure's treble voice = E4, D4, C4, D4 (quarter) and the bass entry (C3 half). Assert unknown/garbage elements don't throw.
- **Layout**: given a parsed score + a width, returns ≥1 system; measures partition without overlap; the `beat→position` map is monotonic.
- **VexFlow renderer**: smoke test — renders the seed to an SVG string/DOM with the expected number of noteheads (41) and two staves per system; no throw. (jsdom; VexFlow's SVG context works headless.)
- **Facade**: `<Notation renderer="musicxml" musicXml={seed} />` mounts, shows notation (an `<svg>`), not the old placeholder text.

## Done when (phase 1)

`<Notation renderer="musicxml" musicXml={mary} />` renders Mary Had a Little Lamb as a correct, legible **static grand staff** (right clefs, key, time, pitches, and quarter/half durations) as scrollable SVG via VexFlow — with the parser, model, layout, and renderer as separate tested units, and the viewport + cursor seams defined for the next increment.

## Out of scope (this spec)

- The dynamic layer (scroll-mode switching, page turns, playback cursor) — designed-in seams only; their own spec next.
- Fetching/storing MusicXML (Plex scores, lesson files), MusicXML *authoring/export*, audio synthesis, and the DEFER notation list above.
