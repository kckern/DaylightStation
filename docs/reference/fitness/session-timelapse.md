# Session Time-Lapse Recap Reference

This document covers the fitness session time-lapse: the always-on camera capture, the
frame store, and the deferred recap render that turns a workout into a silent, sped-up
highlight video.

---

## Overview

Every fitness session produces a silent, motion-forward recap MP4 — the person working
out as the hero shot, with a live picture-in-picture of what they were watching, a header
(show / episode / coin counter / elapsed), and a stat strip (avatars, heart rate, zone,
rpm). The recap is generated automatically; the user does nothing.

The recap exists to give each workout a memorable artifact and a quick visual summary of
the whole session, compressed from tens of minutes down to a few minutes.

Two things make this reliable rather than best-effort:

- **Capture is decoupled from the UI.** The camera records for the entire session no
  matter which panel or widget is on screen, so the common case — a plain show-player
  workout with no camera widget visible — still produces a recap.
- **The render is a safety net, not a single trigger.** Most sessions never send an
  explicit "end" (they time out, the tab closes, or the client crashes). A periodic sweep
  catches those and renders them once they have settled.

---

## What gets captured

Two image streams are captured client-side in real time, both at the configured time-lapse
cadence, and both uploaded through the same screenshot endpoint:

- **Camera frames** (`role: camera`) — the webcam pointed at the person. This is the recap's
  primary feed. With no camera frames there is nothing to render and the recap is skipped.
- **Player frames** (`role: player`) — the workout video element grabbed to a same-origin
  canvas (so the pixels are readable). These become the picture-in-picture overlay; they
  are optional, and a recap renders fine without them (PiP is simply omitted).

Camera capture runs headless for the whole session. A hidden, fully-transparent webcam
surface is kept mounted and decoding (transparent, not removed, so the browser keeps
delivering full-resolution frames) and uploads on an interval independent of any visible
fitness UI. Capture pauses while the tab is hidden and serializes uploads (one in flight at
a time) so a slow network can't pile up requests.

Each upload is recorded against the session as a capture record carrying its role, index,
timestamp, and filename. The raw image files land under the session's screenshots folder in
the media tree; the capture records live in the session's persisted document.

---

## Capture → store → settle → recap → encode

```
 During the session
   ├─ camera frames (role:camera) ─┐
   └─ player frames (role:player) ─┴─► save_screenshot ─► session screenshots dir
                                                          + capture records on the session

 Session ends (one of several ways)
   ├─ explicit "End Session"   ─► fire recap (background)
   ├─ emergency lockdown        ─► finalize active sessions + fire recap (background)
   └─ inactivity / closed tab / crash ─► (no trigger — handled by the sweep)

 Recap render (deferred until settled)
   has the session settled? ── no ─► defer (try again later)
        │ yes
        ▼
   map output frames ─► pick nearest camera + player capture per frame by timestamp
        ▼
   composite each frame (hero + PiP/poster + header + stat strip)
        ▼
   ffmpeg stitches frames ─► silent H.264 MP4
        ▼
   record video on the session ─► delete (or archive) the raw frames
```

### Settle window (why the recap waits)

An interrupted workout that is resumed — or manually stitched — shortly after is treated
as **one** session: a recently-ended, non-finalized session stays eligible to be resumed or
merged for a fixed window after it ends. The recap must obey the same window, because
rendering **deletes the raw captures** as cleanup. Recapping a session that could still be
consolidated would destroy the frames the merged session needs.

So a recap renders only once the session has **settled**, meaning either:

- it was explicitly **finalized** — a clean split the consolidation logic will never
  merge — and can render immediately, or
- it ended **longer ago than the resume/merge window**, so consolidation is no longer
  possible.

A session that has not ended, or ended within the window, is **deferred**: nothing is
rendered, no frames are touched, and the session's recap status is left untouched so a
later attempt retries cleanly. The settle window is a single shared constant used by both
the consolidation logic and the recap, so the two can never drift apart.

### Render statuses & idempotency

The recap status on the session moves through a small state machine:

- **processing** — render in flight; acts as a soft lock against concurrent triggers.
- **ready** — rendered; the video is recorded and the raw frames have been cleaned up.
- **skipped** — the session had no camera captures, so there was nothing to render.
- **failed** — an adapter error during render; the raw frames are **kept** so a retry can
  succeed later.

The render is idempotent. A `ready` or `processing` session is left alone (a `ready`
recap's frames are already gone, so re-rendering would produce nothing and wrongly flip a
good recap to failed). `failed` and `skipped` are **not** skipped — their frames survive,
so an automatic retry is safe and wanted. A manual re-generate can force a re-render past
this guard.

---

## How recaps get triggered

Recaps reach the render along three paths:

1. **Explicit end.** Ending a session fires the recap in the background; the end request
   returns immediately without waiting on the render.
2. **Emergency lockdown.** A lockdown finalizes every active session and fires each one's
   recap in the background.
3. **The recap sweep (the safety net).** Most sessions end the quiet way — inactivity
   timeout, a closed tab, a crashed client — and never trigger paths 1 or 2, so their
   frames would otherwise pile up un-recapped forever (cleanup only happens after a
   successful render). A periodic sweep walks the last few days of sessions and renders the
   recap for any that have settled, still have camera captures, and have no finished recap.
   Sessions that are already done, in flight, known to have no captures, or still within the
   settle window are passed over.

The sweep also **reaps abandoned skeleton sessions**. The always-on screenshot capture
creates a session record the moment frames start arriving, even when no rider ever tags in.
If no participant joins, session persistence refuses to write the session (the roster gate),
so the record never gets an `endTime` — it would otherwise be deferred on every tick forever
(reason `not-ended`) while its captured frames leak on disk. A record that is never finalized,
never ended, has an empty roster, and has stopped capturing past the settle window can neither
be recapped (no workout) nor resumed (no roster), so the sweep deletes it outright — both the
session record and its orphaned frames. Any participant, an `endTime`, or recent capture
activity exempts a session from reaping.

The sweep is a thin orchestrator: every real decision (the settle defer, the idempotency
guard, and the abandoned-skeleton reap predicate) lives in pure policy / the render use case,
so the sweep can never jump the gun or double-render. It runs on the agents scheduler, which
only ticks in the production container — there is no dev-instance double-fire — and the
`processing` status is the soft lock across any concurrent trigger.

## Garbage collection

On the same scheduler tick, after reaping, a frame-store **garbage collector** sweeps the
media tree (`sessions/<date>/<id>/`) for the loose ends the recap pipeline leaves behind:

- **Empty leftover shells** — an `<id>/` dir whose `screenshots/` was cleaned after a
  successful recap. Pruned.
- **Orphan frame dirs** — frames with no owning session record (a true leak). Deleted once
  aged past the settle window.
- **Un-recappable / done-with frames** — frames of a *settled* real session that will never
  (re)render: a recap already succeeded or was terminally skipped, or the session captured no
  camera hero (player-only) so the camera-centric recap can't run. The frames are freed; the
  session record, its summary/stats, and any finished recap video are left untouched.

The GC only ever deletes under the media frame store — it never writes to the data-volume
session record. All decisions live in a pure classifier; window guards keep it from racing a
live capture (a brand-new dir or an orphan whose session YAML hasn't landed yet is left alone
until it ages out). A GC failure is isolated and never fails the recap sweep.

---

## Render details

For each output frame the mapper picks the nearest camera capture (and, if present, the
nearest player capture) by timestamp, then composites the hero camera shot, the PiP /
poster rail, the header, and the stat strip. A best-effort show poster is fetched for the
PiP rail and participant avatars are loaded for the stat strip; either absent simply
degrades that element gracefully. Captures are buffered and reused across frames so one raw
image isn't read from disk many times.

Encoding stitches the rendered frame sequence into a silent H.264 MP4 (audio explicitly
dropped) at the configured output frame rate and quality. The finished video is written
into the fitness video media folder, recorded on the session, and the raw captures are then
cleaned up — deleted by default, or moved aside if frame archival is configured. Anything
short of a finished video leaves the frames in place for a retry.

The whole render is configurable (enable/disable, speed-up factor, output frame rate,
encoder quality, PiP, header, stat strip, frame archival) and config changes take effect on
the next backend start.

---

## Related references

- [Session consolidation / race grouping](./race-session-grouping.md) — the resume/merge
  behavior whose window the recap defers to.
- [Governance engine](./governance-engine.md) — the in-session state (zone, coins) surfaced
  on recap frames.
- [Fitness system architecture](./fitness-system-architecture.md) — where capture and recap
  sit in the larger fitness subsystem.

---

## Source map

- Frontend capture: `frontend/src/modules/Fitness/player/`, `frontend/src/hooks/fitness/`
- Render use cases & policy: `backend/src/3_applications/fitness/usecases/`,
  `backend/src/3_applications/fitness/`
- Snapshot store & encoder: `backend/src/1_adapters/persistence/yaml/`,
  `backend/src/1_adapters/video/`
- API & scheduler wiring: `backend/src/4_api/v1/routers/fitness.mjs`,
  `backend/src/0_system/`
- Operational procedures: `docs/runbooks/fitness-session-timelapse.md`
