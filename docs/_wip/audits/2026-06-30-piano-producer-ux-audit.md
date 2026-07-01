# Piano Producer — Design & UX Audit

**Date:** 2026-06-30
**Scope:** `frontend/src/modules/Piano/PianoKiosk/modes/Producer/` (`Producer.jsx`, `Producer.scss`) + hooks `useLoopLibrary.js`, `useLoopTransport.js`, shared `shared/music/{loopScheduler,layerMatch,loopQuery}.mjs`, and the shell seams in `frontend/src/Apps/PianoApp.{jsx,scss}`.
**Commit under review:** `d1ae82314` — *feat(piano): rebuild Producer as MIDI loop-layering jam surface* (2026-06-30).
**Lens:** frontend-design (distinctive, intentional visual design) + UX/usability + the established PianoKiosk design vocabulary (see `2026-06-22-piano-kiosk-design-ux-sins-audit.md`).

---

## Verdict

**The foundation is genuinely good — and it is the whole reason the UX reads as a crime.**

The rebuild wired a real music engine into the kiosk: a queryable loop catalog (`useLoopLibrary` — one index fetch, lazy per-loop `.mid` parse, memoized), a compatibility ranker that explains *why* a layer fits (`layerMatch.reasonsFor`), a phase-aligned multi-layer cycle builder (`buildLoopCycle`), and a Studio-proven rAF transport that fires notes through the shared `pressNote/releaseNote` so the loop visibly plays the keys. It ships with 78 node + 3 vitest tests. As an *engine*, this is the best-architected mode in the kiosk.

The problem is that **a loop-layering jam instrument has been presented as a spreadsheet.** Every one of those musical affordances — tempo, key, the cycling loop, "which layer is making which sound," "does this layer fit" — is rendered as monochrome text in a single scrolling column with two glyph buttons per row. There is **no bar, no playhead, no beat grid, no waveform, no pad, no meter** — nothing that lets a human *see or feel the music looping*. Every comparable tool (Ableton Session view, Novation Launchpad, Koala, GarageBand Live Loops, Incredibox) makes the loop **visible and spatial** because that is the entire point of a loop station. This one makes it a database query. That gap — great bones, zero musical surface — is exactly what "a crime against humanity" describes.

---

## A. The core experience failure: a jam surface with nothing to jam *on*

### A1. There is no visual representation of the loop — the cardinal sin for a loop station
The only feedback that anything is playing is (a) the `▶ Play` button flipping to `◼ Stop` (`Producer.jsx:99-104`) and (b) keys lighting on the 88-key footer via `activeNotes`. There is **no beat/bar indicator, no playhead, no loop-length readout, no per-layer activity meter.** The user cannot tell *where in the loop they are*, *how long the loop is*, or *which of their stacked layers is currently sounding*. `useLoopTransport` already computes `cycle.lengthMs` and even returns it (`useLoopTransport.js:90`) — the data for a playhead exists and is thrown away.

A loop station's hero is the loop *made visible*. The frontend-design brief: "Open with the most characteristic thing in the subject's world… a live demo, an interactive moment." The most characteristic thing here is **a bar of music cycling** — and it's invisible. This is the single highest-impact fix: a bar/beat playhead (even a simple sweeping line over a 4/8-bar strip), and per-layer lanes that pulse when their notes fire.

### A2. The loop and the player's own hands are visually indistinguishable — the stated design intent is broken
The docstring for the transport promises "the loop lights the keys; jam on top" (`useLoopTransport.js:12-14`). But the loop's notes and the user's notes are pressed into the **same `activeNotes` set** and rendered with the **same highlight** on the same `PianoKeyboard` (`Producer.jsx:41,183`). So when you play over a running loop, **you cannot see your own notes against the loop's** — they are the same color. The "jam on top" affordance defeats itself: the surface that's supposed to teach you *what to add* gives you no way to distinguish what you're adding from what's already there. The keyboard needs two note channels (loop-driven vs. user-played) rendered in two colors.

### A3. You cannot "peek" at a loop before committing it — no audition/cue
Tapping a loop in browse **immediately makes it the base** (`pickBase`, `Producer.jsx:138`); tapping a candidate **immediately drops it into the live mix** (`addLayer`, `:169`). The whole row is a single commit action — there is no way to just *hear* a loop first. Every loop tool provides this "cue/audition/peek" move (headphone-preview in a DAW, tap-to-audition in Splice/Koala/Launchpad) precisely because picking loops is a listening task, not a reading task. Without it, building a stack is blind trial-and-error against the *live* mix: add → hear it clash → remove → try the next, disrupting whatever's already playing each time. For a mode whose entire value proposition is *curated, compatibility-ranked suggestions*, being unable to sample a suggestion before it commits is a core omission.

**Fix — a dedicated "peek" affordance, separate from commit.** Each browse/candidate row should carry its own small **▶ preview** control (distinct from the row's tap-to-add), that auditions the loop **in isolation** — or, more musically, *the candidate layered over the current base* so you hear the actual combination the ranker is proposing — **without mutating the stack.** The engine already supports this at near-zero cost: notes load lazily and cached (`useLoopLibrary.loadNotes`), and `useLoopTransport` builds a cycle from *any* array of layers — so a preview is just a second, ephemeral transport instance fed `[base?, candidate]` that stops on release/blur and never touches `layers`/`setBase`. Pair the peek button with the §G1 staff thumbnail and the user can both **see and hear** a loop before it ever enters the mix.

---

## B. Dead-end interactions (the flow traps a user)

### B1. Picking a base locks you out of browsing — and the only exit nukes your whole stack
The browse UI (search + loop list) renders **only while `!base`** (`Producer.jsx:127`). The moment you pick a base it vanishes, replaced by the stack + candidates. To get back to browsing you must remove the base layer — but `removeLayer` on index 0 **clears the entire stack and unsets base** (`Producer.jsx:78-81`). So there is **no way to change or swap the base without destroying all the layering work you just did**, and no way to add a *non-suggested* loop once you've started (candidates are ranked-against-base only; free search is gone). This is a one-way street with a demolition button at the dead end. Needs: a persistent "change base / add from library" affordance, and base-swap that keeps the stack.

### B2. Removing the base is destructive, unconfirmed, and mislabeled as an ordinary layer
The base row carries the same `✕` remove control as any layer (`Producer.jsx:160`), but pressing it silently wipes the whole session (§B1) with no confirm — the same unconfirmed-destructive-action sin flagged for Studio's delete (`2026-06-22` §A7). The base is structurally special (everything conforms to it) but is presented as a peer row you can delete by mistake.

### B3. Silent truncation hides most of the library
`browse` is `.slice(0, 60)` (`Producer.jsx:87`) and `candidates` is `.slice(0, 30)` (`:84`), with **no count, no "showing 60 of N," no pagination.** A user scanning the list has no idea the catalog is larger, and once a base is chosen, free-text search is gone (§B1) — so loops beyond the top-30 ranked candidates become **unreachable**. Truncation with no signal reads as "that's all there is."

---

## C. Controls that lie or are missing

### C1. Tempo is read-only — a jam tool you can't set the tempo of
`bpm = base?.bpm || 100` (`Producer.jsx:51`) is **display-only** (`:106`). The user cannot change tempo. Worse, all layers are tiled to that single BPM regardless of their own native tempo (`useLoopTransport` passes one `bpm` to `buildLoopCycle`), so stacking loops recorded at different tempos silently misaligns them — with **no tempo control to fix it and no warning that it's happening.** A loop station without a tempo control is missing a primary instrument control.

### C2. "Key" is a semitone shifter wearing a musician's label
The key control shows `Key C` with `−`/`+` (`Producer.jsx:107-111`) and maps directly to `keyShift` semitones over canonical-C MIDI. It's an honest *transpose* but labeled as *key* with no reference to the loops' actual key, no major/minor, no "original" marker. A beginner reads "Key C" and has no idea it means "everything shifted 0 semitones from C." Either make it a real key picker (with the base's detected key shown) or label it "Transpose ±semitones."

### C3. Per-layer control is a lone mute — the standard **Mute / Solo** pair is missing
Each layer offers only mute (`🔊`/`🔇`) and remove (`✕`) (`Producer.jsx:154-160`). Every mixer, DAW, and loop station ships the **M / S (Mute / Solo)** pair per channel as a baseline convention — Mute silences this layer, Solo silences *everything else* so you can isolate and audition one layer in context. Producer has Mute but **no Solo**, so the most common "what is this layer actually contributing?" gesture is impossible; you can only subtract layers one at a time and infer. There is also no per-layer **volume/level**, so you cannot *balance* a stack — only include/exclude at full level.

**Fix:** give every layer the standard **M** and **S** toggles (with the usual semantics: Solo is exclusive-listen; multiple solos are additive; Mute and Solo are independent state). Per-layer level is the natural follow-up. The transport already supports muting by dropping a layer's notes from the cycle (`transportLayers`… `muted` in `Producer.jsx:54-59`) — Solo is the same mechanism inverted (mute all non-soloed), so the engine cost is near-zero; this is a UI + selector addition, not new audio plumbing.

---

## D. Identity & visual craft (the frontend-design tells)

### D1. Mixed glyph iconography — the exact tell called out six days ago, re-committed
The control set is a grab-bag of three glyph languages in one screen: **Unicode line-art** for transport (`▶`/`◼`, `Producer.jsx:103`) and remove (`✕`, `:160`) and key (`−`/`+`, `:108-110`), but **full-color emoji** for mute (`🔊`/`🔇`, `:155`). Sitting inches apart, half the controls are monochrome stroke glyphs and half are rendered emoji at a different weight, baseline, and color — the "this was generated, not designed" signal named in `2026-06-22` §B2/§J7. Should be one SVG icon family sharing a stroke weight and the palette.

### D2. The palette drifts off the kiosk's own design tokens — and re-commits the slop look
`Producer.scss` **hardcodes its own greens and grays** — `#e8e8ee`, `#3a7`, `#8fe`, `#5b8`, `#8ad`, `#cfe`, `#243` — instead of the kiosk's design tokens (`--piano-accent` = `#2ec46f`, `--piano-surface`, `--piano-border`, etc.) that the rest of PianoApp uses. Two consequences: (1) Producer's "green" is a *different green* from every other mode, so it looks subtly foreign; (2) it independently re-lands the "near-black + single acid-green accent" AI-default palette the prior audit flagged (`2026-06-22` §B1), with **none** of the piano's own material vocabulary (ivory/ebony/brass/felt/score-cream). A loop *producer* could lean into a console/mixer identity (channel-strip metals, VU ambers, fader tracks) — instead it's thermostat-green text.

### D3. Slugs are the primary labels — machine language on the shelf (confirmed against the live screen)
The loop's headline is `e.slug` (`Producer.jsx:139,158,170`) — a raw kebab-case filename identifier — and its subtitle is `summaryOf` = roman numerals / scale degrees / descriptor (`:24-29`). Kebab-case is correct for *filenames* and an abomination in the *UI*. The live browse list makes this undeniable:

```
quick-moves-7-1-7-6-stepwise-walkdown      7–1–7–6        Catchy
catchy-waves-shaped-5-6-1-2-3-2            5–6–1–2–3–2     Catchy
darker-catchy-stepwise                    darker-catchy-stepwise   Catchy   ← slug shown TWICE
beautiful-catchy-perfect5th-5-6-1         5–6–1           Catchy
secret-catchy-equation-2-3-5-5-6-1        2–3–5           Catchy
```

Two compounding failures: (1) the headline is a machine identifier a human never chose or recognizes — violating "name things by what people control, never by how the system is built"; (2) when a loop has no `roman`/`degrees`, `summaryOf` **falls back to the slug** (`Producer.jsx:28`), so the same kebab string is printed **as both the title and the subtitle** (`darker-catchy-stepwise` / `darker-catchy-stepwise`, `crying-arp` / `crying-arp`, `pouring-rain` / `pouring-rain`). A row that says the same machine name twice is the purest form of the sin.

**De-kebabing is not the fix — the slug is the wrong data.** A cleaned-up `rock-melody-11-intenseawesomebassline-niko-kotoulas-140bpm` is still garbage: it bakes in an artist, a made-up adjective, and a **tempo** into what should be a musical identity. Three specific rules fall out of the real catalog:

- **Roman numerals are canonical; absolute chord letters are not.** The catalog stores both a letter slug (`am-f-g-am`) and roman (`iii I II iii`). The letters are **redundant with the romans and factually wrong the moment you transpose** — after §C2's key change, `am-f-g-am` is a lie while `iii I II iii` stays true (that's the entire point of roman analysis: it's key-invariant). So the loop's **identity is its roman progression**, full stop. The letter slug should never be a label; if absolute chord names are shown at all, they must be a *derived, live* readout computed from the current key (updating as you transpose), never the stored string.
- **BPM does not belong in the identity.** Tempo is variable and edited in realtime (§C1), so `…-140bpm` in a title is stale by design. BPM lives on the transport, not the label.
- **Melodic loops with no chord structure** (`rock-melody-27-…`, `pouring-rain`) get the **staff-notation thumbnail** (§G1) as their identity — the shape of the melody — plus a short human title, never the slug echoed twice.

The ranker's `same pack` reason (`layerMatch.mjs:51`) similarly leaks the source-file concept and should read musically ("same feel"/"same set").

### D3.1 — Design deliverable: a harmonic-notation typography system
The user's ask is explicit and correct: **"we need a typography system for displaying the Roman chord notation, in chips, labels, or whatever."** Right now roman data is dumped as `e.roman.join(' ')` in the body condensed sans — `iii I II iii` as flat text, quality encoded only by letter case that Roboto Condensed renders indistinctly, extensions/accidentals not handled at all. This is also the answer to the prior audit's §B3 ("undifferentiated condensed sans, no typographic personality"): **roman-numeral harmonic analysis is the piano's own engraved vernacular — this is exactly where a display face finally earns its place.**

Proposed `<RomanChord>` / `<RomanProgression>` primitive + type spec (one component, reused in chips, list rows, layer strips, and the §G4 keyboard overlay):

- **Face:** a proper engraving/serif or true small-caps face for the numeral body (the sheet-music vocabulary), *not* Roboto Condensed. This is the one place to spend a display face.
- **Case is semantic — preserve it, never uppercase.** Major = full caps `I IV V`; minor = small-caps/lowercase `ii iii vi`; diminished = `vii°`; augmented = `III⁺`. Case + °/⁺ carry chord *quality* and must survive rendering.
- **Extensions & inversions as true superscripts:** `V⁷`, `ii⁶₅`, `I maj⁷`, `vi⁹` — via OpenType `sups`/`subs` or styled `<sup>`, tabular-aligned so a row of chips stays on one baseline.
- **Accidentals as real glyphs, de-emphasized:** `♭VII`, `♯iv°` with the ♭/♯ a touch smaller/muted so the numeral reads first.
- **Progression layout — two presentations from one primitive:** inline run with hairline separators for dense rows (`iii · I · II · iii`), or one chip per chord for the base/layer strips and the browse card. Chips make the harmony *scannable* and set up the §A1 playhead (highlight the chip that's currently sounding).
- **Restraint:** quality is already legible from case + figures; do **not** also color every chord. At most one accent for the dominant (the functional pull), and only if it reads — otherwise monochrome. (Chanel's "remove one accessory": the notation itself is the signature; don't gild it.)

ASCII of the intended loop card (identity = notation, metadata = quiet tags, no slug, no bpm-in-title):

```
┌───────────────────────────────────────┐
│  ⤵ iii   I   II   iii        ▶ peek    │   ← roman chips = the loop's identity
│  ﹅ staff thumbnail﹅        Catchy      │   ← §G1 notation + one mood tag
└───────────────────────────────────────┘
```

Net: kill the slug and the letter-chord string from the UI entirely; render the **roman progression through the type system** as the loop's face; keep mood/pack as small muted tags; and never put BPM in a title.

### D4. No first-run orientation — you're dropped into a query box
When the library loads, the mode is: role chips + a search input + 60 slug rows (`Producer.jsx:116-146`). There is **no one-line explanation of what Producer is or how to start** ("Pick a base loop, then stack layers that fit"). `PianoEmpty` is used for loading/error but not for the *empty-canvas* first-run state, which is precisely where "an empty screen is an invitation to act" applies. The menu tile sells "Beats, loops & jam" (`PianoMenu.jsx:20`); the landing delivers a database search with no on-ramp.

---

## E. Layout & touch-fit

### E1. Everything competes in one scroll column above a fixed 9rem keyboard
The body is a single `overflow-y:auto` column (`Producer.scss:10-17`) stacking deck → role chips → (browse **or** stack+candidates), pinned above an always-present 9rem keyboard footer (`Producer.jsx:182-190`). On the piano tablet (SM-T590, landscape ~1200×720 minus browser chrome) the keyboard + app chrome leave a cramped band in which the deck controls, the growing layer stack, *and* a 30-item candidate grid all fight for the same scroll. As the stack grows, the "Add a layer" candidates get pushed further below the fold with no fixed home. The transport/deck (the thing you return to constantly) should be pinned, not scroll away with the list.

### E2. Mute/remove are sub-target glyph buttons on a touch wall
`piano-layer__mute` and `piano-layer__remove` are `background:none; border:none` single-glyph buttons (`Producer.scss:128,135`) — well under a 44px touch target, no hit-area padding, on a surface meant for fingers on a wall. The house rule is discrete, chunky tap targets (`feedback_touch_ui_no_sliders`); these are the opposite.

### E3. Quality-floor gaps
No `:focus-visible` anywhere in `Producer.scss` (D-pad/gamepad/keyboard nav shows only the default ring on a dark surface); the mute toggle exposes no `aria-pressed`/label and remove/`✕` no accessible name (`Producer.jsx:154,160`); role chips carry no selected semantics beyond the visual `is-on`. Reduced-motion is fine (only `.12s` hover transitions), but the accessibility floor the skill treats as non-negotiable isn't met.

---

## F. Code rot introduced/left by the rebuild

### F1. The deleted audio-kit Producer's CSS is still in `PianoApp.scss` and collides with the new module — the new layout secretly depends on the dead block
The rebuild deleted `producerEngine.js`, `useProducer.js`, etc., but **left the old Producer's stylesheet in the global `PianoApp.scss` (lines 1854-1901)** — a full `.piano-producer-mode` block with `&__platter` (spinning turntable), `&__pads`, `.piano-pad`, and `@keyframes piano-producer-spin`. That global block **collides with the new module `Producer.scss`**, which redefines the *same* selectors (`.piano-producer-mode`, `&__body`, `&__deck`, `&__keys`). The two disagree — e.g. `&__body` padding is `1.5rem` (old, `PianoApp.scss:1858`) vs `1rem 1.25rem 0` (new, `Producer.scss:10-17`); `&__deck` gap `1.5rem` vs `1rem` — and which wins depends on stylesheet source order, not intent.

Most telling: **the new keyboard footer has no height of its own.** `Producer.scss:79` sets only `flex:0 0 auto` on `&__keys`; the actual `9rem` keyboard height comes from the **dead** `PianoApp.scss:1885` block. So the new Producer's layout is silently propped up by CSS belonging to the mode it replaced — delete the dead block (the correct cleanup) and the keyboard footer collapses. This is a latent breakage and a maintenance trap. Fix: remove `PianoApp.scss:1854-1901` **and** give `Producer.scss` its own explicit keyboard height (ideally reusing the pad/turntable visual language the old block already had — see D2/A1; that spinning-platter + pad metaphor was closer to a real loop station than the list that replaced it).

## G. The missing bridge: `frontend/src/modules/MusicNotation/` is already built and unused here

Producer reinvents (badly) three things that `modules/MusicNotation/` already does well, and ignores the one renderer purpose-built for the exact problem in §A2. This module is the highest-leverage integration available because **it consumes the data Producer already holds** — every loop is loaded as `{ ppq, notes:[{ ticks, durationTicks, midi }] }` (`useLoopLibrary.js:60-63`), and MusicNotation's renderers take MIDI note numbers directly.

### G1. Replace the kebab slug with the loop's actual notation (fixes §D3 *and* §A1 at once)
`SvgStaffRenderer` takes `targetPitches: number[]` (MIDI) and renders a staff; `ChordStaffRenderer` takes a `notes` Map and engraves a grand-staff chord. Producer already has the MIDI for every loop. So each browse/candidate/layer row can carry a **small staff thumbnail of what the loop actually plays** instead of (or above) the machine slug. That turns the "wall of kebab strings" into a **shelf of readable musical phrases** — the loop's identity becomes its *music*, which is both the correct fix for §D3 and a big step toward §A1 (the loop made visible). This is the single change that most directly answers "a crime against humanity": the browser stops being a filename list and becomes sheet music you pick from.

### G2. `SvgStaffRenderer`'s ghost-notes are the exact fix for §A2 (loop vs. hands)
`SvgStaffRenderer({ targetPitches, activeNotes, matched })` already renders `activeNotes` as **50%-opacity ghost notes distinct from the target notes** (`SvgStaffRenderer.jsx:30-45`). That is precisely the "show the loop, show my hands on top, in two visual weights" affordance Producer's own docstring promises but its shared-`activeNotes` keyboard can't deliver. Feed the *loop's* current notes as `targetPitches` and the *player's* live `activeNotes` as ghosts and the jam-over-loop distinction the mode is built around finally shows up — reusing a component that already exists and is already tested.

### G3. `detectKey` + `diatonicTranspose` fix the mislabeled "Key" control (§C2)
The key control is a raw chromatic semitone shifter mislabeled "Key" (§C2). MusicNotation exports `detectKey(pitchClasses, currentKey)` (`model/keySignature.js:41`) — run it over the base loop's pitch classes to show the **real detected key** ("Key: G major") instead of a semitone counter, and `diatonicTranspose` / `KEY_SIGNATURES` to transpose *within a key* musically rather than by blind chromatic offset. The base's notes are already in hand the moment `pickBase` resolves.

### G4. Roman-numeral chord readout on the keyboard's left-hand region — a toggle worth having
For a *piano* loop tool the on-screen keyboard is the natural place to teach harmony: when the left hand plays a chord, show **its roman numeral** (I, ii, V⁷, vi…) under that region of the keyboard — either derived live from the played notes, or lit from the loop's *known* structure when one is playing. The harmony stack is already in the tree and needs no new theory code:
- **Live from the hands:** `theoryEngine.detectChords(midiNotes)` (tonal) and `ChordNamePanel`/`describeChord` already name a chord from a MIDI set; `PianoKeyboard` already segments the left hand via `splitNote` (`PianoKeyboard.jsx:81,108`), so the left-hand `activeNotes` below the split are exactly the notes to analyze.
- **To a roman numeral:** feed the detected chord + the current key (`detectKey`, §G3) through `shared/music/romanAnalysis.mjs` / `chords.mjs` (both already do key-agnostic roman analysis) to get the degree.
- **From the loop when structure is known:** loops already carry `roman` in `index.yml` (`Producer.jsx:25`, `layerMatch.mjs:21`); with the base's key and the transport's playhead position (the same `lengthMs`/beat clock from §A1) you can highlight *which* roman in the progression is sounding right now — turning the loop into a live harmony lesson.

**Seam note:** `PianoKeyboard` today only does *per-key* labels (`showLabel`, note name at each C) — it has **no region/overlay label facility.** This needs a small, opt-in addition: a prop like `handChordLabel` (or a thin overlay band positioned over the sub-`splitNote` keys) rendered above the left-hand zone, gated behind a **toggle** (off by default so it stays out of the way when jamming, on when learning). Keep it a labeled overlay, not per-key glyphs, so it reads as one chord symbol, not 88 annotations.

### G5. Don't rebuild — the seam is one import
Everything above is exported from the module's barrel (`modules/MusicNotation/index.js`: `SvgStaffRenderer`, `ChordStaffRenderer`, `Notation`, `detectKey`, `diatonicTranspose`, `KEY_SIGNATURES`), plus the existing harmony helpers (`theoryEngine.detectChords`, `ChordNamePanel`, `shared/music/romanAnalysis.mjs`). The model is also the shared SSoT the Studio staff and drill grader already use, so integrating here keeps Producer's notation consistent with the rest of the kiosk instead of inventing a fourth music surface. Net: Producer should **depend on MusicNotation (and the shared theory helpers) for every note-to-visual, key, and chord operation**, and delete its ad-hoc `summaryOf`/`keyName`/`NOTE_NAMES` string helpers (`Producer.jsx:20-29`) in favor of it.

## H. Compatibility is *metric*, not *harmonic* — the matcher and scheduler don't gate on the progression

This is the deepest issue and it's an engine/data problem, not a pixels problem. Producer sells "compatibility-ranked layers that auto-conform to the base," but **nothing in the stack actually checks that two loops share a chord progression** — the one thing that makes layering sound right. The roman progression should be the *organizing key* for the entire library (chords, melody, bass, ideas alike), the *filter* for what can stack, and the *alignment unit* for how it stacks.

### H1. The ranker scores everything *except* the sequence
`compatibilityScore` (`layerMatch.mjs:27-43`) weights role-complement, mood, **mode-of-the-first-chord only** (`modeOf`, `:20-25`), same-pack, same-artist, and tempo closeness. It **never compares the roman arrays to each other.** So a candidate with a totally different progression but the same "Catchy" mood and pack scores *high*, while a perfect harmonic match sitting in a different pack scores *low*. For a layering instrument that's backwards: **same-progression is the primary compatibility signal** (arguably a gate — "safe to stack"), and mood/pack/tempo are tie-breakers, not the basis. The `reasonsFor` chips ("same pack", "tempo match") advertise the proxies instead of the real reason ("same progression: iii I II iii").

### H2. The scheduler phase-aligns by *bars*, not by *chords*
`buildLoopCycle` sets master length = the longest layer's whole-bar length and tiles shorter layers by integer **repeat count** (`loopScheduler.mjs:58-70`, `loopLengthTicks` rounds up to bars). That aligns layers *metrically* but not *harmonically*: a 2-bar `I V` melody under a 4-bar `I V vi IV` base is tiled to `I V | I V`, so bars 3–4 play `I V` against `vi IV` — a clash the tool is supposed to prevent. "Auto-conform to the base" currently means "transpose + tile to bar length," which is not conforming harmony at all.

### H3. Sequences span variable bars → they need a *normalized harmonic signature*
As you note, `II VI V` might be realized as 3 bars, 6 bars, or 9 — same harmony, different rate/repetition. Matching on the raw `roman` array won't see those as equal. The library needs a **canonical harmonic signature** per loop: the minimal repeating chord cycle (collapse consecutive duplicates / factor out whole-cycle repeats) **plus** the bar-span it's realized over. Then: two loops are stackable iff their signatures are equal (or one is a clean multiple/sub-cycle of the other), and the scheduler uses the **bar-span** to stretch/tile so chord *changes* coincide (H2's fix) instead of bar counts. This makes "3-bar `II VI V`" and "6-bar `II VI V`" first-class layermates.

### H4. The metadata to do any of this doesn't exist for every role yet — run classifiers over the data files
Chord-progressions and basslines carry `roman` in `index.yml`, but **melodies and ideas largely don't** — which is exactly why the pasted `rock-melody-*` rows had no summary and fell back to the slug (§D3), and why `feeling-myself-3-5-6` shows melodic *scale degrees* (`3–5–6`) rather than a chord *function* sequence (degrees ≠ roman). To classify and filter *all* roles by progression, an **offline harmonic-analysis pass over the `.mid` files** is needed: the notes are already parseable (`@tonejs/midi`, same as `useLoopLibrary.loadNotes`), and the theory stack §G leans on (`tonal`, `shared/music/romanAnalysis.mjs`, `chords.mjs`) can infer per-window chords → roman degrees → the normalized signature (H3), writing `roman` + `barSpan` + `signature` back into `index.yml`. Two honest caveats to scope: (a) inferring *implied* harmony from a bare melody/bassline is genuinely harder than reading a chord voicing and will need review/confidence thresholds; (b) this is a backend/tooling deliverable (a classifier CLI over the loop catalog), separate from the frontend work — but the frontend §§D3/G/H all depend on its output, so it's on the critical path.

---

## Priority ranking

| # | Finding | Severity | Effort | Fix |
|---|---------|----------|--------|-----|
| H1–H4 | Compatibility is metric, not harmonic — matcher/scheduler don't gate on the progression; melodies lack `roman` | **Highest** (foundation) | High | Classifier over `.mid` → normalized signature + barSpan in `index.yml`; gate stacking on same-sequence; align scheduler on chord changes |
| G1 | Kebab slugs instead of the loop's notation — integrate `MusicNotation` staff thumbnails | **Highest** | Med | `SvgStaffRenderer`/`ChordStaffRenderer` per row (also fixes §A1/§D3) |
| A1 | No visual loop — no playhead/bar/beat, `lengthMs` thrown away | **Highest** | Med | Bar/beat playhead + per-layer activity lanes |
| G2 | Loop notes vs. user notes indistinguishable — use `SvgStaffRenderer` ghost notes | **High** | Low | Loop = targets, live hands = ghosts (fixes §A2) |
| A2 | Same, on the shared keyboard | **High** | Med | Two-color keyboard channels (loop vs. jam) |
| C3 | No **Solo** (and no per-layer level) — only a lone mute | **High** | Low | Standard M/S per layer; Solo = mute-all-others |
| B1 | Base-lock: can't rebrowse/swap base without wiping the stack | **High** | Low | Persistent "change base / add from library"; keep stack on base-swap |
| C1 | Tempo read-only; cross-tempo layers silently misalign | **High** | Med | Tempo control + warn/normalize mismatched-BPM layers |
| A3 | No "peek" — can't hear a loop before it commits to the mix | **High** | Low–Med | Per-row ▶ preview (ephemeral transport, doesn't mutate the stack) |
| F1 | Dead audio-kit CSS collides in `PianoApp.scss`; footer height depends on it | **High** | Low | Delete `PianoApp.scss:1854-1901`; own keyboard height in `Producer.scss` |
| D1 | Mixed emoji + Unicode glyph controls (re-commits `06-22` §B2) | High (identity) | Low | One SVG icon family, palette-tinted |
| D2 | Palette hardcoded off the kiosk tokens; re-lands slop green | High (identity) | Low | Use `--piano-*` tokens; derive a mixer/console identity |
| C3 | Per-layer control is mute/remove only — no volume/solo | Med | Med | Per-layer level + solo |
| B3 | Silent `slice(60)`/`slice(30)` truncation; rest unreachable after base pick | Med | Low | Count + "more"; keep search available with a base |
| D3 | Kebab slugs / absolute chord letters / bpm as labels (letters lie on transpose) | **High** | Low | Roman = canonical identity; drop slug, letters, bpm-in-title |
| D3.1 | No typography system for roman-chord notation | **High** (identity) | Med | `<RomanProgression>` primitive: semantic case, sup figures, ♭/♯ glyphs, engraving face |
| C2 | "Key" is a mislabeled semitone shifter | Med | Low | `detectKey` + `diatonicTranspose` from `MusicNotation` |
| B2 | Base removal destructive, unconfirmed, mislabeled as a peer row | Med | Low | Confirm; distinguish base control from layer delete |
| E1 | Single scroll column; deck scrolls away above fixed keyboard | Med | Med | Pin the deck/transport; give candidates a fixed home |
| G4 | Roman-numeral chord readout on the keyboard's left hand (toggle) | Low (delight) | Med | `detectChords`+`romanAnalysis`; new `PianoKeyboard` region-label prop |
| D4 | No first-run orientation / empty-canvas guidance | Med | Low | One-line on-ramp + empty state |
| E2/E3 | Sub-target glyph buttons; no focus-visible / aria | Med | Low | Chunky targets, focus ring, labels |

---

## One-paragraph summary for the busy reader

Producer's engine is the best-built thing in the kiosk — a lazy-loaded loop catalog, a compatibility ranker that explains its picks, a phase-aligned cycle builder, and a Studio-proven transport, all under TDD — and that's exactly why the surface disappoints: a loop-layering *instrument* has been rendered as a scrolling list of raw kebab-case filenames (printed twice per row when a loop has no theory summary) with two glyph buttons beside each, and **no way to see or feel the loop cycling.** The loop's identity is wrong at the root: it labels loops with a machine slug plus an absolute chord string (`am-f-g-am`) that's redundant with — and *falsified by* — transpose, when the **roman progression (`iii I II iii`) is the canonical, key-invariant identity** and deserves a real harmonic-notation type system (semantic case, superscript figures, ♭/♯ glyphs, an engraving face — the display-face personality the kiosk has never had); BPM has no business in a title it can edit in realtime. The biggest single win is already built and sitting unused next door: `frontend/src/modules/MusicNotation/` consumes the exact MIDI Producer already loads, so its staff renderers can replace the filename wall with **readable notation** (the loop's identity becomes its music), its ghost-note staff draws **the player's hands over the loop in two weights** (the "jam on top" the mode promises but can't currently show), and its `detectKey`/`diatonicTranspose` turn the mislabeled semitone "Key" into a real one. Add the two conventions any mixer user expects — per-layer **Mute *and* Solo** (Producer has only Mute) and a **tempo** control — plus a bar/beat playhead (the `lengthMs` is already computed and thrown away), and unlock the flow so you can re-browse/swap the base without the demolition-button dead end. Underneath, delete the deleted-Producer's CSS still squatting in `PianoApp.scss` (the new footer height is secretly borrowing from it) and pull the hardcoded greens back onto the kiosk's design tokens. And the deepest fix is invisible but foundational: the "compatibility-ranked, auto-conforming" promise isn't real yet — the matcher never compares progressions (it proxies on mood/pack/tempo) and the scheduler tiles layers by bar count, not by chord changes, so a 2-bar `I V` can play straight through a 4-bar `I V vi IV`; making layering actually *sound* right needs a classifier pass over the `.mid` files to give every loop — melodies included — a normalized roman signature the ranker can gate on and the scheduler can align to. Good bones; it just needs to look, sound, and behave like the loop station it already is on the inside.

---

*Files reviewed: `modes/Producer/Producer.jsx`, `modes/Producer/Producer.scss`, `useLoopLibrary.js`, `useLoopTransport.js`; shared `shared/music/{loopScheduler,layerMatch,loopQuery}.mjs`; `modules/MusicNotation/` (`index.js`, `renderers/SvgStaffRenderer.jsx`, `renderers/ChordStaffRenderer.jsx`, `model/keySignature.js`, `model/drillTranspose.js`) for the integration path; shell `Apps/PianoApp.jsx`, `Apps/PianoApp.scss` (Producer block + dead audio-kit block), `PianoMenu.jsx`; sibling `modes/Studio/Studio.jsx` for the mode-shell quality bar; plus the live browse screen the user pasted. Cross-referenced against `docs/_wip/audits/2026-06-22-piano-kiosk-design-ux-sins-audit.md`.*
