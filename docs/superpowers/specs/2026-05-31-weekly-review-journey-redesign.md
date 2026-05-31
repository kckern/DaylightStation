# Weekly Review — Journey Redesign (Browsing-First)

**Date:** 2026-05-31
**Status:** Design spec — proposed. Supersedes the current navigation model in `frontend/src/modules/WeeklyReview/`.
**Scope:** Interaction model, navigation topology, and the complete remote-input matrix. UX/journey only — no implementation detail.

---

## 1. Intent

Weekly Review is a living-room ritual for looking back on the week. A person sits down with the Nvidia Shield remote, the past week's media appears, and they page through it — talking aloud as they go. The voice recording runs the entire time but is **ambient**: it never competes for the remote and never gates navigation.

**Center of gravity: browsing is the star.** Re-living the week visually is the point; the recording is a side-channel that quietly captures whatever the person says while they explore. Every design decision below favors fast, satisfying, lean-forward browsing with a D-pad.

The only reliable inputs on the target hardware are **↑ ↓ ← → (D-pad), ⏎ (OK), and ⤺ (Back)**. Back is intercepted inconsistently by the kiosk browser, so **every exit and every "climb out" has a D-pad equivalent that does not depend on Back.**

---

## 2. Navigation model — two levels

The old three-level hierarchy (week → day dashboard → fullscreen photo) collapses to **two levels**. The mandatory "day dashboard" screen is gone: a day *is* a fullscreen media reel, with its facts available on demand via ↓.

```
  WEEK GRID                         DAY REEL
  ┌──┬──┬──┬──┐      ⏎ on a day  ┌─────────────────────┐
  │  │  │  │  │ ───────────────▶ │   ███ media ███     │
  ├──┼──┼──┼──┤                  │                     │
  │  │  │  │  │ ◀── ↑ / ⤺ ────── │  ← / → step media   │
  └──┴──┴──┴──┘                  │  ↓ = day context    │
  8 most recent days,            └─────────────────────┘
  each cell a media collage       ←← / →→ cross days
```

### Two global rules that make it learnable

1. **↑ and ⤺ both "climb one level."** They are identical everywhere *except* on the grid (where ↑ also navigates between rows). The level stack is:
   `Week grid → Day reel → Video playing`.
   Climbing past the top (the grid) raises the exit gate.

2. **Double-tap a horizontal direction at an edge to cross.** ← / → step through media and **hard-stop** at the day's first/last item. A single press at the edge bumps and shows a "cross day" hint; a **second press within ~500 ms** crosses into the adjacent day. (Reuses the existing double-press gesture window already in the codebase.)

---

## 3. The two surfaces

### Week grid (the menu)
A 4×2 grid of the **8 most recent days**. Each cell is a living collage of that day's media (the photo-wall layout, preserved), annotated with date, weekday, weather, and small chips for calendar events and workouts. Focus starts on the **most recent day**. Empty days are visually dimmed.

The **recording bar** sits at the bottom as pure status — live indicator, running timer, level meter, sync state. It is never focusable and never a stop in the D-pad path.

### Day reel (inside a day)
Fullscreen. One unified strip of that day's **photos and videos** in chronological order. A focused photo fills the screen with a small always-on caption (time taken, people in frame). A focused video shows its poster frame with a `▶ Enter` hint. The **day context panel** (↓) overlays timeline, weather, people, calendar events, and workouts on demand.

---

## 4. Complete remote-input matrix

Legend: **↑ ↓ ← →** D-pad · **⏎** OK · **⤺** Back · *double* = two presses within ~500 ms.

### 4.1 Browsing states

#### A — Week grid
`r0` = top row (cells 0–3), `r1` = bottom row (cells 4–7).

| Button | Action |
|--------|--------|
| **←** | Focus previous cell in the row. At column 0: **hard stop** (no row-wrap). |
| **→** | Focus next cell in the row. At column 3: **hard stop**. |
| **↑** | From `r1`: move to `r0` (cell − 4). From `r0`: **raise the exit gate** (State F). |
| **↓** | From `r0`: move to `r1` (cell + 4); if no day there, **hard stop**. From `r1`: **hard stop**. |
| **⏎** | Open the focused day → **Day reel** at item 1. If the day is empty, opens the reel's empty state (B-empty). |
| **⤺** | **Raise the exit gate** (State F) — direct, from any cell. |

#### B — Day reel · photo focused

| Button | Action |
|--------|--------|
| **←** | Previous item. At the **first item**: hard-stop + arm "cross to previous day" (`◂◂ prev day` hint). |
| **→** | Next item. At the **last item**: hard-stop + arm "cross to next day" (`next day ▸▸` hint). |
| **⏎** | **Next item** (same as →). A photo's only action is to move on. |
| **←←** *(at first item)* | Cross to the **previous day → its last item**. No previous day: hard stop. |
| **→→** *(at last item)* | Cross to the **next day → its first item**. No next day: hard stop. |
| **↑** | Climb one level → **week grid** (focus returns to this day's cell). |
| **↓** | Open the **day context panel** (State E). |
| **⤺** | Same as ↑ → week grid. |

*Single-item day: ← and → both immediately hit the edge and arm cross-day.*

#### B-empty — Day reel · empty day

| Button | Action |
|--------|--------|
| **←** / **→** | Arm cross-day immediately (double-tap crosses to the adjacent day). |
| **↑** / **⤺** | Week grid. |
| **↓** | Open the day context panel (often the only content — calendar/weather). |
| **⏎** | No-op (nothing to advance to or play). |

#### C — Day reel · video focused (poster, not playing)
Navigation identical to B; only ⏎ differs.

| Button | Action |
|--------|--------|
| **←** / **→** / **←←** / **→→** | Same as State B (step / cross day). |
| **↑** / **⤺** | Week grid. |
| **↓** | Day context panel (State E). |
| **⏎** | **Play the video, muted** → State D. |

#### D — Video playing (`D` muted / `D′` unmuted)

| Button | Action |
|--------|--------|
| **⏎** | **Toggle mute** (muted ↔ unmuted). |
| **←** / **→** | Stop the video, move to **previous / next item** (← / → keep their universal "step" meaning). Edge + double-tap cross-day as in State B. |
| **↑** / **⤺** | Climb one level → **stop video, return to its poster** (State C). *Not to the grid — playback is its own level; this matches Netflix/YouTube/Plex "back returns to where you launched it."* |
| **↓** | **Pause** + open day context panel (State E); resumes on close. |
| *video ends* | Returns to its **poster** (State C). |

*Seeking/scrubbing intentionally omitted — these are short personal clips (YAGNI). Could later be a hold-→ gesture.*

#### E — Day context panel (modal overlay over the reel)
Read-only: timeline, weather, people, calendar events, workouts. A playing video is paused behind it.

| Button | Action |
|--------|--------|
| **↓** | Close → back to media (resume video if it was playing). |
| **↑** | Close → back to media. (A *second* ↑ then climbs to the grid.) |
| **⤺** | Close → back to media. |
| **←** / **→** | Inert (panel is day-level — nothing to flip). *Future: jump to a timeline entry's media.* |
| **⏎** | No-op (read-only). |

### 4.2 The exit gate

#### F — "End review & save?" confirm
Buttons: **[Keep going]** **[Save & end]**. Default focus = *Keep going*. Recording continues until *Save & end* is chosen.

| Button | Action |
|--------|--------|
| **←** / **→** | Toggle focus between the buttons. |
| **↑** / **↓** | Also toggle focus (forgiving — any direction). |
| **⏎** | Activate. *Keep going* → close, return to grid. *Save & end* → finalize recording, exit the app. |
| **⤺** | Cancel → close, return to grid (= *Keep going*). |

### 4.3 Recording-lifecycle overlays (carried over)

These pre-empt the browsing layer by priority, highest first:
**mic-unavailable → disconnect → save-failure → exit-gate → resume-draft.**

#### G — Mic warming up ("Listening for your microphone…")
Soft gate at launch over the grid; recording hasn't truly begun.

| Button | Action |
|--------|--------|
| **← / → / ↑ / ↓ / ⏎** | **Fall through** to the grid — pre-navigate while the mic warms. |
| **⤺** *(or ↑ past top)* | Exit — **no save-confirm** (nothing recorded yet). |

#### H — Mic unavailable (modal)
Buttons: **[Retry]** **[Exit]**, default focus *Retry*.

| Button | Action |
|--------|--------|
| **← / → / ↑ / ↓** | Toggle focus. |
| **⏎** | Activate (Retry restarts the mic; Exit leaves). |
| **⤺** | Exit. |

#### I — Mic disconnected mid-session (auto-managed)
Informational: "reconnecting…" then "saving…".

| Button | Action |
|--------|--------|
| **All buttons** | **Inert** — blocked until it auto-resolves (resumes to the prior browsing state, or auto-finalizes and exits). |

#### J — Resume prior draft (prompt at launch)
One action: **[Finalize previous]**. The grid is browsable behind it.

| Button | Action |
|--------|--------|
| **⏎** | Finalize the previous recording, then continue into the grid. |
| **← / → / ↑ / ↓** | Fall through to the grid. |
| **⤺** | Dismiss / defer (the draft stays; can be finalized later from the bar). |

#### K — Save failure (modal, at the end)
Buttons: **[Dismiss]** **[Exit (save later)]**, default focus *Dismiss*. Reassures that audio is safe locally and on the server.

| Button | Action |
|--------|--------|
| **← / → / ↑ / ↓** | Toggle focus. |
| **⏎** | Activate. |
| **⤺** | Dismiss. |

---

## 5. Why this is the optimal browsing journey

- **One primary motion.** ← / → means "previous / next" everywhere — the muscle memory a lean-forward browser wants. ⏎ reinforces it on photos ("next").
- **Depth is cheap and reversible.** ⏎ dives (plays a video), ↑ pops out — you can study a photo or watch a clip and be back in one or two taps, never lost.
- **Hard stops + double-tap.** You never *accidentally* leave a day; crossing is one deliberate extra tap. Same idiom as the existing double-press gesture, so nothing new to learn.
- **Metadata on demand (↓).** The screen stays photo-first, but the week's facts are always one press away.
- **Videos respect the recording.** Muted-first, deliberate unmute — a clip's soundtrack doesn't fight the narration.
- **Exit only from the top.** You can't fumble out mid-browse; leaving is a deliberate act with a save-confirm, and ↑/⤺ from the grid both reach it.
- **Back is never load-bearing.** ↑ mirrors every ⤺, so the unreliable kiosk Back button is never the only way out of any state.

---

## 6. What changes from today's build

| Today | Redesign |
|-------|----------|
| Three levels: grid → day dashboard → fullscreen photo | Two levels: grid → day reel (media + on-demand context) |
| Day view is a dense dashboard (timeline + sidebar + gallery) | Day is a fullscreen media reel; dashboard content moves to the ↓ context panel |
| Recording bar is a focusable row (↓ from grid bottom lands on it) | Recording bar is ambient status only — never focusable |
| Down-from-grid-bottom / focus-bar to save | Exit gate reached by ↑-past-top or ⤺ from the grid |
| Fullscreen flips photos only; videos played from the day gallery | Unified reel: photos and videos in one strip; ⏎ plays a video in place |
| Double-Enter is the exit gesture (Back-independent escape) | ↑ is the Back-independent escape; double-tap ← / → is repurposed to cross days |
| Photo fullscreen: ↑ = next photo, ↓ = exit | Reel: ⏎/→ = next, ↑ = exit, ↓ = day context |

Carried over unchanged: durable chunked recording + upload, resume-draft recovery, disconnect auto-recovery, save-failure handling, the photo-wall collage layout, and the day's data sources (Immich photos/videos, calendar, fitness sessions, weather).

---

## 7. Open questions / deferred

- **Video seeking** — omitted for now; revisit if longer clips appear (candidate: hold-→ to scrub).
- **Timeline jump** — the ↓ context panel could let a timeline entry jump to its media; deferred to keep the panel read-only initially.
- **Day ordering in the grid** — most-recent-first vs. chronological reading order; a presentation detail that doesn't affect the input model.

---

## 8. See also

- Current module: `frontend/src/modules/WeeklyReview/`
- Reference (current behavior): `docs/reference/life/weekly-review.md`
- Life planning domain this feeds: `docs/reference/life/life-domain-architecture.md`
