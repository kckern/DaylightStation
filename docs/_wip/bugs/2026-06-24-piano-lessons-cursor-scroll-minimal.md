# Lessons drill: cursor barely scrolls; want full-scroll + touch history

- **Source:** voice feedback `piano/20260624194621_kHqrPg` · route `/piano/lessons/01` · reported 2026-06-24
- **Audio:** `media/audio/feedback/piano/20260624194621_kHqrPg.webm`
- **Type:** bug (+ enhancement)
- **Area:** Piano · Lessons drill (Hanon follow-along)

## What the user said
> On the lessons, we're looking at Hanon exercise number one, and when the cursor
> gets to the far right, it starts scrolling, but it barely scrolls enough to see
> the most recent one. I think it should do a full scroll to the left, so that the
> cursor ends up about 10% from the left, instead of just doing the minimum possible.
> And then I think it should be possible to swipe and scroll via touchscreen to the
> stuff in the past, and maybe somewhat to the future, but then it should snap back
> after some time to the cursor, so the cursor's around the 10% from the left part.

## Problem / opportunity
The follow-along cursor uses `scrollIntoView({ block: 'center' })`-style minimal
scrolling: when it reaches the right edge it advances just enough to reveal the next
notehead, so the player is always reading at the far right with no lookahead. The
desired model is a "teleprompter": keep the active note pinned near the **left** so
the upcoming notes are visible ahead of it.

## Desired outcome
- When the cursor advances past a threshold, scroll so the **active note sits ~10%
  from the left edge** (generous lookahead), not the minimum nudge.
- The player can **swipe/drag (touch) to scrub** backward through already-played
  notes (and a little into the future).
- After a short idle, the view **snaps back** to the cursor at the ~10%-from-left
  resting position.

## Actionable tasks
- [ ] Replace the minimal `scrollIntoView` with explicit scroll math that targets
      the active notehead at ~10% of the scroll-container width.
- [ ] Add horizontal touch drag/swipe on the staff to scrub the engraving.
- [ ] Add an inactivity timer that animates back to the cursor's resting position.
- [ ] Keep it smooth (the kiosk is the SM-T590 — animate transform/scrollLeft, avoid
      layout thrash; see the waterfall/vsync notes).

## Acceptance criteria
- Playing through a drill keeps the active note ~10% from the left with notes visible
  ahead of it.
- Dragging left reveals past notes; releasing + waiting snaps back to the cursor.

## Where to look
- `frontend/src/modules/Piano/PianoKiosk/modes/Lessons/LessonDrill.jsx` —
  `applyHighlight()` calls `cur.scrollIntoView({ behavior: 'smooth', block: 'center' })`;
  this is the scroll to replace.
- `frontend/src/modules/MusicNotation/renderers/AbcRenderer.jsx` — the engraved
  staff/scroll container.

## Context / evidence
No errors in the log snapshot — this is a UX behavior gap, not a crash. More detail:
`media/logs/piano`.
