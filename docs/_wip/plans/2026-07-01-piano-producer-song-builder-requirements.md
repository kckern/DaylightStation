# Piano Producer — Functional Requirements

**Date:** 2026-07-01
**Status:** Functional requirements (WIP) — direction, not design
**Scope:** The Producer mode of the Piano Kiosk

---

## How to read this document

This is a **functional requirements** document. It describes *what the
experience must let people do* and *why* — the human outcomes we're trying to
achieve.

It deliberately does **not** prescribe UX, screens, controls, data models, or
APIs. The technical implementer has **full authority to gut, rewrite, or
replace** anything currently in the codebase. The existing assets listed in the
Appendix are offered as *available raw material*, not as constraints. The only
things that constrain the implementer are the **human experience** and the
**requirements** below.

Where this document names an existing capability, read it as "this already
exists if you want it," never as "you must build on this."

---

## 1. What Producer is for

Producer is a **creative music surface** at the piano kiosk. Its center of
gravity is helping a person build a **backing composition** — the harmony, bass,
percussion, and structure of a song — that a human can then **perform** melody,
vocals, or play-along over.

The composition (the arrangement) is the artifact worth keeping. The performance
is largely a live, in-the-moment act on top of that backing.

But Producer is **not limited to song-building**. It must be equally satisfying
for someone who only ever wants to throw down a single loop and jam. Depth is
available, never required.

### Primary payoffs, in priority order

1. **A saved multi-section song** — the arranged backing a person built and can
   reload and play again. *(Highest value to preserve.)*
2. **A reusable preset** — a loop-stack or section a person liked enough to keep
   and reuse in other songs.
3. **A great live jam** — an in-the-moment performance over evolving loops;
   satisfying even if nothing is saved.
4. **A captured recording of a performance** — lowest priority overall, *except*
   for recording one's own loops (notably drum grooves), which is a wanted
   capability.

---

## 2. Guiding principles

### 2.1 Progressive depth — never a forced path

Producer must be a valid, complete experience at every level of commitment. A
person can stop at any level and walk away happy:

- **Just jam** — one loop, play along, never touch sections or saving.
- **Play the library** — browse loops, swap instruments, audition, noodle.
- **Stack & shape** — layer loops, mute/solo, adjust key/tempo/voices; a richer
  jam that is still one eternal section.
- **Build a song** — *opt in* to sections, arrangement, and repeat counts.
- **Perform & keep** — play the arrangement as backing, improvise on top,
  optionally record and save.

Structure is **additive and lazy**: songs, sections, and saving come into
existence only the moment a person reaches for them. There is no "create a song
first" ceremony gating the jam. The deeper affordances are *offered*, never
nagged.

### 2.2 Creativity above all

Every stage must be maximally conducive to creativity: trivial to try things,
easy to keep what works, and forgiving of experimentation. Nothing should punish
a person for exploring.

### 2.3 Guardrails by default ("bumpers")

Stacking loops must **sound good by default — even for a person who is tone
deaf**. Harmonic and key compatibility are locked in ahead of time so a person
cannot *accidentally* build something that clashes:

- Only compatible material is offered as stackable.
- Key is auto-conformed so layers agree without the person managing it.
- A deliberate **expert override** may exist for intentional rule-breaking, but
  the safe path is always the default.

### 2.4 Roman harmonics are one building block among many

Chord-progression harmony (expressed in roman numerals) is a powerful organizing
idea, but it is **not the whole model**. Percussion, melody, and instrument
choice each have their own logic and must not be shoehorned into the roman
framework. The experience must treat different kinds of musical material on their
own terms.

---

## 3. The material: kinds of loops and how they behave

Producer works with distinct **kinds** of musical material. Each kind has its own
identity and its own compatibility rules. This is functional behavior the
experience must honor — not a storage schema.

| Kind | How a person identifies it | What "compatible" means |
|---|---|---|
| **Harmonic** (chord progressions, basslines) | Its roman-numeral progression (e.g. `I–V–vi–IV`), plus a visual glyph and color | Same or related progression, mode, and key |
| **Melodic** (melodies, ideas) | Its contour/shape, plus a visual glyph and color (no roman numerals) | Fits *over* a given harmony — good over some progressions, not others; key-relative |
| **Percussion** (grooves) | A visual glyph, color, and feel (no roman, no key) | Tempo and feel only — harmonically neutral, fits anything |
| **Instrument / voice** | Its own timbre identity | A *dimension applied to* a loop (what it sounds like), not a stackable loop itself |

### 3.1 Identity and recognition

- **Roman-numeral signature is the stable identity for harmonic material.** A
  loop is known by its progression, not its key. The current key is shown as a
  label that updates whenever the person transposes; the progression is what
  persists.
- **Every piece of material gets a glanceable visual identity** — a
  **deterministic glyph plus a seeded color**, so that in a pick-and-choose
  surface a person recognizes "the one I liked last time" by its picture and
  color, without memorizing any code. The same material always yields the same
  glyph and color.
- **No fabricated names.** A human-readable title is used when one is available,
  but where it isn't, the glyph + color (+ roman progression, for harmonic
  material) is sufficient identity. We never invent a fake name just to have one.

### 3.2 Discovery

- A person can **browse** the library and filter by the qualities that matter
  (kind, mood, feel, etc.).
- **Harmonic compatibility is a first-class way to discover material**, not only
  an after-the-fact suggestion. A person should be able to ask, in effect, "show
  me what goes with this" and get compatible material — whether or not they've
  already committed to a base.

---

## 4. Building blocks of a composition

Expressed functionally (the implementer decides the actual structures):

- **A loop** is a single piece of looping musical material of one kind, carrying
  a choice of **instrument/voice**.
- **A layer** is a loop placed into a mix, with independent control (at least:
  on/off, isolate, and relative level) and its own instrument.
- **A section** (verse, chorus, bridge, etc.) is an **independent stack** of
  layers with its own progression and feel. Sections are independent by default
  — a person builds each one deliberately, from scratch or by cloning another.
- **An arrangement** is an **ordered sequence of sections with repeat counts**
  ("8× verse, 6× chorus, 4× bridge, back to verse").
- **A song** is the whole thing — its sections, its arrangement, and its global
  musical context (key, tempo) — and it can be **saved and reloaded**.
- **A preset** is any reusable unit a person chose to keep (a loop-stack or a
  whole section) for use in other songs.

### 4.1 Continuity vs. independence

Sections are independent, but the experience must make **continuity** easy so a
song feels cohesive rather than like disconnected fragments:

- **Instrumentation should be able to carry across sections** — e.g. the same
  drum kit and the same bass voice used in both verse and chorus, even when the
  parts they play differ.
- **A layer (such as a groove) should be able to persist across sections** while
  the harmony changes underneath it.
- Global musical context (key, tempo) is shared across the song by default.

The balance to strike: **coherence by default, full freedom when wanted.**

---

## 5. Playback and performance

- **Both a written arrangement and live control must be possible.** A person can
  define an arrangement that plays through on its own (auto-advancing through
  sections and repeats), *and* grab control at any time to trigger sections by
  hand for a jam. Capturing a live-triggered performance into a saved
  arrangement is desirable.
- **The backing plays the piano** — the on-screen (and physical) keyboard should
  visibly reflect what the loops are playing, so a person can see and follow the
  harmony while performing.
- **A person performs on top** — improvising melody, singing, or playing along.
  The experience must invite and support this layered human performance.
- Standard live controls a person expects while playing: start/stop, tempo, key,
  and per-layer balance/isolation.

---

## 6. Percussion (a required capability for v1)

Percussion does not exist in the library today and must be built out:

- Percussion is a **first-class kind of material** and the primary vehicle for
  rhythmic continuity across sections.
- The library should be **seeded with at least one simple usable groove**, and
  be able to **grow via imported drum MIDI** (packs sourced as needed).
- A person should be able to **record their own groove** (e.g. by playing drums
  on the keyboard), which ties directly into the broader "record your own loop"
  capability.
- MIDI already handles percussion natively (a standard drum map); a drum **sound
  source** must be available so grooves are audible.

---

## 7. Recording your own material

- A person can **record their own loop** — most importantly grooves, but melodic
  and harmonic ideas too — and use it like any other piece of material.
- Recorded material participates in the same identity, compatibility, and
  layering behavior as curated material.
- **Layering over oneself** (building up a part in passes) is a desirable
  extension, not a v1 requirement.

---

## 8. Persistence

- A person can **save a song** and reload it later to keep playing or editing it.
- A person can **save a preset** (a stack or a section) and reuse it in other
  songs.
- Saving is **opt-in and lazy** — it never gates the shallow, just-jam
  experience.

---

## 9. Priorities and non-goals

**Prioritize (v1):**

- The shallow, no-commitment jam experience (must be excellent on its own).
- Guardrailed, compatible loop stacking with visual identity for material.
- Section building + arrangement with repeat counts, and saving songs.
- Percussion as a first-class kind, seeded and importable, with a sound source.

**Secondary / later:**

- Full live-trigger performance capture into arrangements.
- Recording one's own melodic/harmonic loops (grooves are the priority case).
- Layering over oneself across multiple passes.
- Any expert "break the rules" override of the compatibility guardrails.

**Explicit non-goals:**

- Producer is **not** required to funnel everyone into song-building.
- We do **not** fabricate names for material that lacks a human title.
- This document does **not** dictate UX, screen layout, controls, data model, or
  APIs — those are the implementer's to design.

---

## 10. Open questions for the technical spec

- What is the **sound source for the drum kit**, given the instrument/voice
  bridge is still maturing? (Percussion audibility is a hard dependency.)
- How is **melody-over-harmony compatibility** best determined so the guardrails
  feel musical (not just same-key filtering)?
- How much of the ~3,200 existing loops needs **content hygiene** (titles,
  categorization) before the visual-identity and discovery goals feel good?
- Where do **saved songs and presets** live, and are they per-person at the
  kiosk?

---

## Appendix — Existing assets (available raw material, NOT a constraint)

> The implementer may use, replace, or ignore any of this. Listed so the
> technical spec writer knows what already exists.

- **~3,223 canonical-MIDI loops** already curated under `media/midi/loops/`
  (served at `/api/v1/local/stream/midi/loops/…`, indexed by `index.yml`):
  ~1,655 chord progressions, ~1,154 melodies, ~391 ideas, ~23 basslines, and
  **zero percussion**. Entries already carry roman/signature (harmonic), degrees
  (melodic), mood, bpm, bar span, and pre-computed key transpositions.
- **A pure, tested music engine** under `shared/music/` (`@shared-music`):
  compatibility scoring, browse/faceting, loop scheduling, roman analysis,
  harmonic signatures, transposition, and MIDI-to-notation.
- **Piano kiosk building blocks**: a loop library loader, a looping multitrack
  transport, a multi-engine instrument/voice bridge (SFZ grand / FM, with a
  native component still pending), BLE-MIDI keyboard input, and mix/sound
  contexts.
- **UI components** already exist for a playable keyboard, roman-progression
  display, and staff/notation thumbnails.
- **Deterministic seeded avatars are readily available** via DiceBear
  (e.g. `https://api.dicebear.com/10.x/identicon/svg?seed=I-V-vi`) — a seed
  string yields a stable glyph, which could serve the glanceable
  visual-identity goal (§3.1) with no custom art. One option among others; the
  implementer chooses the approach.
- **Sibling kiosk modes** (Studio, Lessons, Composers) share patterns worth
  reviewing — Studio's playback is the ancestor of the current loop transport.

The **current Producer** is a single-section loop-stacking jam: pick one base
loop, stack compatibility-ranked layers that auto-conform to its key, loop the
stack, mute/solo layers, transpose, and play along. It is a working starting
point for "just jam," but has **no** concept of sections, arrangement, repeat
counts, percussion, saving, or recording — which is the gap this document
defines.
