# Weekly Review

**Last Updated:** 2026-06-18

---

## Purpose

Weekly Review is a living-room ritual for reflecting on the week that just passed. It assembles everything the household captured over seven days — photos and videos, calendar events, fitness sessions, and daily weather — into a single browsable surface, and it records the person's spoken reflection while they look back through it.

The experience is built for a couch and a remote, not a keyboard and mouse. A person sits down in front of the TV, the week appears, the microphone starts listening, and they narrate their week aloud while paging through the days. When they're done, they save and the recording is preserved for transcription and later review.

It is the capture half of a reflective cadence: the screen surfaces the evidence of the week, and the voice recording becomes the raw narrative the person can revisit or feed into longer-term life planning.

---

## Where It Runs

Weekly Review is designed to appear on a TV screen driven by a remote. The primary target is the living-room Nvidia Shield, where the only reliable inputs are the directional pad, the OK button, and the Back button. Every interaction in the experience is reachable with those buttons alone — there is no expectation of a pointer, a text field, or a full keyboard.

Because the Shield's kiosk browser intercepts the Back button inconsistently, the experience never relies on Back as the sole way out of any state. Every exit and every "go up a level" has a directional-pad equivalent as well.

It can be launched three ways, and behaves the same in each: as a widget inside a screen, as a dismissible overlay, or as a standalone page. The only difference is what "exit" hands control back to.

---

## The Core Journey

1. **Open.** The person opens Weekly Review. The week's data loads and the days appear as a grid. At the same moment, the microphone begins warming up.

2. **Microphone warms up.** A gentle "Listening for your microphone…" overlay appears while the mic is acquired. The person can already start moving around the grid underneath it — the overlay is an invitation to start talking, not a hard gate. As soon as the first real audio is heard, the overlay clears and recording is officially underway.

3. **Browse and narrate.** The person moves across the week, opening individual days, paging through photos, playing videos, and talking through what happened. The whole time, the recording bar shows that the mic is live, how long they've been recording, and that their audio is being saved. If the mic stops hearing them, a visible prompt nudges them to speak up.

4. **Save and close.** When finished, the person ends the session. The recording is flushed and finalized on the server, and the experience exits back to wherever it was launched from. Finalizing is bounded by a short timeout, so save-and-exit always returns promptly even if the network is wedged — the audio is durable either way and any unfinished upload is finalized on the next visit.

The person is never trapped. From any screen there is always a way to back out, and any attempt to leave while recording asks for confirmation rather than silently discarding the reflection. A persistent control legend along the screen always shows the buttons that matter right now — including how to exit.

---

## What the Week Looks Like

### The grid (top level)

The week is laid out as a 4×2 grid of the eight most recent days. Each cell is a living collage of that day's media — the day's photos and videos arranged by quantity (a single photo fills the cell; a busier day tiles into a balanced mosaic; the most photo-filled days show the first items and a "+N" badge). Each cell is also annotated with the date, weekday, weather, and small chips for calendar events and workouts.

A day counts as having content if it has photos, workouts, *or* calendar events. Days with no media are never blank: instead of an empty tile they surface that day's context — the weather (a large icon and high/low), or, failing that, the weekday name — so the cell still reads as a real day. Days with nothing recorded are visually dimmed so the eye is drawn to the days where something happened.

Every one of the eight days is rendered as a focusable cell, so directional focus can always move within the grid and can never fall out of the view.

Focus starts on the most recent day.

The recording bar sits at the bottom of the grid as a pure ambient status display. It is never part of the D-pad path.

### The day reel (inside a day)

Opening a day enters a fullscreen media reel — one unified, chronological strip of every photo and video from that day.

Opening a day with no media doesn't drop into a blank screen: the reel shows the day's context directly — its weather, timeline of calendar events and workouts, people, and summary counts — the same facts that otherwise live behind the context panel.

- A focused **photo** fills the screen with a small caption showing the time it was taken and any people in the frame.
- A focused **video** shows its poster frame with a play hint. Pressing Enter plays it muted; pressing Enter again unmutes. Pressing Enter a second time on an unmuted video re-mutes. When a video ends or the person backs out of it, the view returns to the poster.

Pressing Down at any point opens the **day context panel**: a read-only overlay showing the day's timeline of events and media, weather conditions, people recognized across the day's photos, and summary counts of photos, videos, events, and workouts. Pressing Down, Up, or Back closes the panel.

---

## The Recording Bar

A persistent bar across the bottom of the week grid is the person's status display for the whole session. It shows:

- **The week label** ("Week of Apr 14 – Apr 20").
- **A microphone indicator** — live when audio is flowing, lost if the mic has dropped.
- **A recording dot and running timer** once recording is underway.
- **A live level meter** that moves with the person's voice, so they can see they're being heard.
- **A silence prompt** — when the mic stops picking up audio, the bar surfaces a visible "we can't hear you" message inviting the person to speak up or check the mic.
- **A sync badge** reporting where the audio stands: actively syncing with a count still pending, saved a moment ago, queued, or saved locally while offline.

The bar is status-only. It is never focusable and never receives D-pad focus — it is never a step in the navigation path. The level meter and timer update continuously and smoothly, deliberately decoupled from the browsing layer so that watching your voice move the meter never makes the grid feel sluggish.

---

## Navigation Model

The experience has two browsing levels. Moving "in" goes deeper (week grid → day reel → video playing); moving "out" climbs back up. The level stack is:

```
  WEEK GRID                         DAY REEL
  ┌──┬──┬──┬──┐      Enter on a   ┌─────────────────────┐
  │  │  │  │  │  ─── focused ──▶  │   full-screen       │
  ├──┼──┼──┼──┤         day       │   media strip       │
  │  │  │  │  │  ◀── ↑ / Back ──  │                     │
  └──┴──┴──┴──┘                   │  ← / → step media   │
                                  │  ↓ = day context    │
                                  └─────────────────────┘
                                    ←← / →→ cross days
```

### The control legend

A persistent legend sits at the edge of the screen and always shows the handful of buttons that matter in the current context — opening a day and navigating on the grid; browsing, opening details, and going back in a photo or video; muting or stopping a playing video; closing the details panel. On the grid it always shows how to **exit**. The legend steps aside whenever a prompt is up, because the prompt carries its own choices.

### Two rules that make it learnable

1. **Up and Back both "climb one level."** They are identical everywhere except on the grid (where Up also navigates between rows). Climbing past the grid's top raises the exit gate.

2. **Double-tap Left or Right at an edge to cross to the adjacent day.** Left and Right step through the day's media and hard-stop at the first and last item. A single press at an edge shows a "cross day" hint; a second press within about half a second crosses into the adjacent day.

### Nvidia Shield remote — button reference

#### On the week grid

| Button | Action |
|--------|--------|
| **Left / Right** | Focus the previous / next day cell in the row. Hard stops at column edges — no row-wrap. |
| **Up** | From the bottom row: move to the top row. From the top row: **raise the exit gate**. |
| **Down** | From the top row: move to the bottom row. From the bottom row: **hard stop**. |
| **Enter** | Open the focused day → day reel at the first item. |
| **Back** | **Raise the exit gate** — from any cell. |

#### On the day reel — photo focused

| Button | Action |
|--------|--------|
| **Left** | Previous item. At the **first item**: hard stop + arm "cross to previous day" hint. |
| **Right** | Next item. At the **last item**: hard stop + arm "cross to next day" hint. |
| **Left Left** *(double-tap at first item)* | Cross to the **previous day's last item**. No previous day: hard stop. |
| **Right Right** *(double-tap at last item)* | Cross to the **next day's first item**. No next day: hard stop. |
| **Enter** | **Next item** — a photo's only action is to move on. |
| **Up** | Climb one level → **week grid** (focus returns to this day's cell). |
| **Down** | Open the **day context panel**. |
| **Back** | Same as Up → week grid. |

#### On the day reel — video focused (poster, not playing)

| Button | Action |
|--------|--------|
| **Left / Right / double-tap** | Same as photo focused (step / cross day). |
| **Enter** | **Play the video, muted.** |
| **Up** | Week grid. |
| **Down** | Day context panel. |
| **Back** | Week grid. |

#### While a video is playing

| Button | Action |
|--------|--------|
| **Enter** | Toggle mute (muted ↔ unmuted). |
| **Left / Right** | Stop the video, move to the previous / next item. Edge + double-tap cross day as usual. |
| **Up** | Climb one level → **stop video, return to its poster**. (Playback is its own level; Up returns to where the video was launched from, not all the way to the grid.) |
| **Down** | Pause video + open day context panel. Video resumes when the panel closes. |
| **Back** | Same as Up → return to video's poster. |
| *Video ends naturally* | Returns to the video's poster. |

#### On the day context panel

Read-only — timeline, weather, people, calendar events, workouts.

| Button | Action |
|--------|--------|
| **Down** | Close → back to the reel (resume video if it was playing). |
| **Up** | Close → back to the reel. A second Up then climbs to the grid. |
| **Back** | Close → back to the reel. |
| **Left / Right** | Inert — nothing to step through. |
| **Enter** | No-op (panel is read-only). |

#### On the exit gate ("End weekly review recording?")

Two choices: **Keep going** and **Save & end**. Default focus is *Keep going*. Recording continues until *Save & end* is chosen.

| Button | Action |
|--------|--------|
| **Left / Right** | Toggle focus between the two buttons. |
| **Up / Down** | Also toggle focus. |
| **Enter** | Activate. *Keep going* → close, return to grid. *Save & end* → finalize recording, exit. |
| **Back** | **Save & end** — a second Back while the gate is up always escapes. Mashing Back can never strand the person in front of the gate; it commits the save and leaves. |

### Exit: reached from the grid only

The exit gate is only reachable from the week grid — by pressing Up off the top row, or pressing Back from any cell. This means the person cannot accidentally exit mid-browse; leaving is a deliberate act that always goes through the save confirm.

### Why every "up and out" has a directional equivalent

Throughout the experience, Up climbs out of every level — day reel, video playback, context panel. This is intentional: Back is unreliable on the target hardware, so the directional pad alone is always enough to navigate the entire hierarchy, exit any level, and reach the exit gate — without ever pressing Back.

---

## Prompts and Interruptions

The experience speaks to the person through a small set of focused prompts. Each is operable with the same remote buttons: where a prompt has two choices, Left/Right (or Up/Down) move between them and Enter chooses; Back generally cancels. When a prompt opens, keyboard and screen-reader focus moves onto it so assistive technology announces it, and each dialog is labelled for screen readers.

When several of these conditions could appear at once, the more important one wins, and a more important prompt can never be displaced by a less important one. Priority order, highest first: microphone unavailable → microphone disconnected → save failure → exit gate → resume draft.

### Resume an unfinished recording

If a previous session for this week was started but never properly closed — the app was shut, the device rebooted, the network dropped — the person is offered the chance to **finalize the previous recording** when they return, or to choose **Not now**. Nothing is lost either way; the unfinished audio is still held both locally and on the server, and "Not now" (or Back) simply defers — the same draft is offered again on a later visit. Finalizing the prior draft runs in the background, so the prompt clears immediately and the grid behind it becomes usable right away. The grid stays browsable the whole time the prompt is up.

### Confirm ending the session

Any attempt to leave while recording brings up the exit gate with two choices: keep going, or **save and end**. This is the gate that prevents a reflection from being thrown away by an accidental Back press or an errant remote — and because a second Back on the gate commits the save and leaves, repeatedly mashing Back always escapes rather than getting stuck.

### Microphone unavailable

If the microphone never produces audio within the warm-up window, the person is told the microphone is unavailable and offered **Retry** or **Exit**. Retrying restarts the capture from scratch.

### Microphone dropped mid-session

If the mic disconnects while recording, the experience takes over automatically: it shows "Microphone dropped — reconnecting…" and attempts to recover on its own. If it recovers, the prompt clears and recording continues seamlessly. If it can't, it switches to "Saving your recording…", finalizes what was captured, and exits — so a hardware hiccup ends in a saved reflection rather than a lost one. These messages are informational; the remote is intentionally inert while recovery is in progress.

### Save failure

If saving fails at the very end, the person is reassured that **the recording is safe** — held both locally and on the server — and can either dismiss the message or exit and let it finish saving later. The person is never trapped by a failed save.

---

## Durability — Why the Reflection Survives

A weekly reflection is something a person says once; the experience treats it as precious.

- Audio is captured in short segments and continuously handed off to be saved, rather than held until the end.
- Each segment is queued and uploaded as it's produced, with the sync badge reporting progress. If the network is down, segments are kept locally and the badge says so.
- If the person closes the page or the device navigates away mid-session, a final flush is fired so in-flight audio still reaches the server.
- Saving and ending finalizes the recording on the server, but that step is bounded by a short timeout: if the server can't be reached in time, the experience exits anyway rather than hanging on the exit screen, and leaves the local draft in place.
- On the next visit, any segment that didn't make it — including a draft whose finalize timed out — is offered for finalization through the resume prompt.

The result is that closing the lid, a dropped connection, or a reboot degrades gracefully into "finish saving this later" rather than "your reflection is gone."

---

## Design Principles

- **Five buttons are enough.** Everything is reachable with Up, Down, Left, Right, Enter, and Back — and everything except a few prompts is reachable without Back at all.
- **Never trap the person.** Every level climbs out, every exit is one gesture away, and every failure path still lets the person leave.
- **Never lose the reflection.** Leaving while recording always confirms first, and the audio is durably saved as it's spoken, not at the end.
- **Browsing is the star.** Re-living the week visually is the point; the recording is a quiet side-channel that captures whatever the person says while they explore.
- **Depth is cheap and reversible.** Up pops out of any level in one press; crossing into an adjacent day takes one deliberate double-tap.
- **Metadata on demand.** The screen stays media-first; the day's facts are one Down-press away and disappear the same way.
- **The mic is honest.** A live indicator, a moving level meter, a running timer, a silence prompt, and a sync badge mean the person always knows whether they're being heard and saved.
- **No empty space.** A day with no media still shows its weather, calendar, and fitness context rather than a blank tile or screen, so every day reads as a real part of the week.
- **Accessible by default.** Empty states stay readable, the controls are described for screen readers, and opening a prompt moves focus onto it so assistive technology announces what's being asked.

---

## See Also

- Module implementation: `frontend/src/modules/WeeklyReview/`
- Life planning domain this feeds into: [life-domain-architecture.md](./life-domain-architecture.md)
- Shield remote input constraints: see the FullyKiosk / Shield TV notes in `CLAUDE.md`
