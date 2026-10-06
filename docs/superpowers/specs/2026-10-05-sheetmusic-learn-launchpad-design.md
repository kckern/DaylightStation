# Sheet Music Learn Launchpad Design

## Intent

Sheet Music Learn must give a child one obvious next action without turning completed work into a dead end. A completed rung is an achievement and an unlock, never a disabled or irreversible state. Every unlocked named drill remains replayable, and every segment supports a simple custom run.

## Experience

Selecting a segment opens a landscape launchpad. The excerpt and durable progress remain visible on the left; the right side presents one dominant recommended action, Practice again, Make your own, and a secondary Test out challenge. All actions use icon-and-label cards with 64px minimum targets and 88px primary choices.

Practice again lists unlocked named drills, including completed drills. Make your own chooses hands, No beat / Keep a beat / Play on time, and (for beat modes) a named tempo stage. It launches one fresh passage run. No sets/reps control is exposed.

Every run ends on an explicit result choice. Official work offers Next drill, Practice again, and Back. Optional work offers Play again, Change setup, and Back. Nothing auto-dismisses or auto-starts another run.

## Progress Semantics

Persisted pass counts describe achievement. A replay starts with zero temporary passes. An optional run may add one pass only when segment, effective parts, practice mode, and required tempo exactly match an unlocked, unfinished rung. Progress is capped and never regresses. All terminal attempts remain in the attempt ledger with launch-source and configuration context.

The existing practice YAML and API remain backward-compatible. Assessment, notation extraction, metronome, countdown, and click scheduling remain single-sourced in the existing engines.

## Visual Contract

Green means earned/correct, amber means Up next, blue means selectable/in progress, and gray means unavailable. State is also written in text. Existing house SVGs are used; missing concepts receive matching repo-native SVGs. The current large `4–3–2–1 → PLAY` countdown is retained.

The primary target is the 1280×800 landscape piano tablet. Representative states must fit without clipping or page scroll, preserve a legible excerpt, support reduced motion and keyboard focus, and expose accessible names independent of icon and color.

