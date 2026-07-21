# Piano watchdog — less aggressive, user-controlled recovery

**Date:** 2026-07-10
**Status:** implemented (frontend staged, not yet deployed; bridge config applied)

## Problem

The piano tablet (SM-T590) occasionally hits a GPU/renderer starvation latch
(see `reference_piano_tablet_jank_current_state`). Two watchdogs react:

- **Frontend `useRenderWatchdog`** — passive already (`SELF_HEAL_RESTART=false`).
- **Bridge `KioskWatchdog`** — every 2s, on `DECAYED` (fps<12 for 5s) or `DEAD`
  (no heartbeat 12s) it runs an escalation ladder **and re-runs it every 60s**:
  L1 touch-burst → **L2 `loadStartUrl` (reload)** → **L3 `restartApp`** → **L4 reboot**.

Users saw: surprise page reloads, "automated restarts", and — because
`useReloadGuard` installs a `beforeunload` handler during video — the browser's
**"navigate away from this page?"** prompt when L2 reloaded mid-video. And we have
since proven L2/L3 **do not clear this latch** (only a reboot does), so they were
pure, repeating disruption.

## Decision

Make recovery **user-controlled** and stop the silent aggression.

1. **Bridge (config only — no APK rebuild):** `watchdogMinFps=1`. The bridge now
   only acts on a **true hang** (fps→0 / no heartbeat), where the page is too dead
   to prompt. It ignores alive-but-slow jank, leaving that to the frontend modal.
   Its L1→L4 ladder still exists for the true-hang case (a reload revives a dead
   page; reboot is the last resort). Reversible via `/config`.

2. **Frontend modal (`RebootPromptModal` + `useJankRebootPrompt`):** when frame
   presentation stays below 12fps *while visible* for a sustained **60s**, show a
   calm modal: **"The display is running slowly — Reboot now / Not now."**
   - *Reboot now* → `window.fully.reboot()` (a device reboot is the only fix).
   - *Not now* → snooze **1 hour** (persisted in `localStorage`, survives reloads),
     then the prompt **re-arms**.
   - Detection logic (`jankRebootLogic.js`) is pure + unit-tested; snooze/rearm too.

3. **Remove the "navigate away" prompt:** `useReloadGuard` is now a **no-op**
   (kiosks have no user pull-to-refresh; the prompt only surprised users). Call
   sites unchanged.

## Components

| Unit | Responsibility |
|------|----------------|
| `jankRebootLogic.js` | pure `isSnoozed` / `shouldPrompt` (testable, no DOM) |
| `useJankRebootPrompt.js` | rAF fps sensor + snooze persistence + reboot action |
| `RebootPromptModal.jsx` | presentational dialog (self-styled; reboot / not-now) |
| `useReloadGuard.js` | now a documented no-op |
| bridge `watchdogMinFps=1` | true-hang-only auto-recovery |

## Not doing (YAGNI / constraints)

- No APK changes to `KioskWatchdog` (can't build from this host; config suffices).
- No prevention of the latch itself (proven to be device/GPU-level, not app-fixable;
  reproduction requires a real interactive session — separate track).

## Tunables (defaults, chosen "less aggressive")

- Modal delay: 60s sustained · Snooze: 1h · minFps: 12 · bridge `watchdogMinFps`: 1.
