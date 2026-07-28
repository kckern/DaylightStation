# Auto-Studio Entry — Design

**Date:** 2026-07-28
**Feature:** On the piano kiosk main menu, sustained MIDI playing automatically
opens Studio (the live-feedback surface: circle-of-fifths · staff · chord
triptych, note waterfall, touch keyboard). "Sit down and play" becomes the
kiosk's resting default.

## Trigger

A pure detector, `shouldAutoEnterStudio(noteHistory, now, cfg)`, fires when —
within a rolling `windowSeconds` — the note-on count is at least `minNotes`
AND the first→last span of those note-ons is at least `minSpanSeconds`.

The two-dimensional rule (count AND span) rejects the failure modes of simpler
triggers: a stray key-brush while tapping the menu (too few notes), a single
held note (one note-on), one chord (≤5 simultaneous note-ons, no span), a
forearm bump or fast glissando (many note-ons, near-zero span). A real player
crosses it ~3–4 seconds after sitting down.

Defaults (in `resolvePianoConfig`, overridable per `piano.yml`):

```yaml
autoStudio:
  enabled: true
  minNotes: 8
  minSpanSeconds: 3
  windowSeconds: 10
```

`noteHistory` entries already carry timestamps (noteStore `handleNoteOn`), so
the detector needs no new data plumbing.

## Arming state machine

New hook `useAutoStudioEntry`, mounted in `PianoShell` beside `useIdleGap` and
`useInactivityReturn`:

- **Fire:** armed, on the menu index route, criteria met → relative
  `navigate('studio')` (Studio index = the Play tab), log
  `piano.auto-studio.enter` (info) with the triggering counts.
- **Disarm:** a *manual* Studio → menu navigation. The idle-return also
  navigates to the menu, so the inactivity callback marks its own navigation
  ("idle" flag ref) — idle-driven returns do NOT disarm.
- **Re-arm:** only after a fresh sitting — no notes and no touch for the
  existing `inactivityMinutes` (same signals `useInactivityReturn` watches; no
  new timer concept). Log `piano.auto-studio.disarm` / `.rearm` at debug.
- Initial state: armed.

## Non-goals / unaffected behavior

- No auto-recording: the always-on household MIDI history already captures all
  play; Studio's Record button stays manual (and hidden for guests).
- Armed on the menu index route only — never yanks any other mode (games,
  lessons, playalong, composer, videos).
- No guest special-casing: live feedback works for guests unchanged.
- Connect gate needs no handling: no bridge → no notes → no trigger.
- The shared note store means pre-switch notes are already in the waterfall
  when Studio appears.

## Testing

- Pure detector unit tests: single chord, glissando burst (count w/o span),
  slow noodling (span w/o count), real playing (fires), window expiry.
- Hook tests (fake timers): fires only on the menu route; manual Studio→menu
  exit disarms; idle-flagged return does not disarm; re-arms after
  `inactivityMinutes` of quiet; `enabled: false` inert.
