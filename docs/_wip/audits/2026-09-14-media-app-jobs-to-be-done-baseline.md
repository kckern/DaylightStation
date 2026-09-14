# Media App — Jobs-to-be-Done Baseline (AS IS)

**Date:** 2026-09-14
**Status:** Baseline. Records the app as built; proposes no changes.
**Code at:** `b2ff8a460`
**Scope:** `frontend/src/Apps/MediaApp.jsx` and every JSX component it renders:
the 41 components under `frontend/src/modules/Media/`, plus the three shared
`frontend/src/modules/Content/combobox/` components that render inside it
(`ContentCombobox`, `ResultRow`, `StreamStatusLine`).
**Design reference:** [`docs/reference/media/media-app.md`](../../reference/media/media-app.md)

**Why this exists.** The next step is a redesign that separates concerns in the
UX. Before that starts, this records what the app does *for a person* today and
which component does it. It is a UX audit, not a code audit. Providers, hooks,
and wire contracts come up only where they decide what a person sees or where a
tap goes.

Paths are relative to `frontend/src/modules/Media/` unless given in full.

---

## Contents

1. [Method](#1-method)
2. [Who uses it, from where](#2-who-uses-it-from-where)
3. [The screen as built](#3-the-screen-as-built)
4. [Job inventory at a glance](#4-job-inventory-at-a-glance)
5. [Jobs in detail](#5-jobs-in-detail)
6. [Component → job index](#6-component--job-index)
7. [Cross-cutting evaluation](#7-cross-cutting-evaluation)
8. [Reference-doc drift](#8-reference-doc-drift)
9. [Questions the redesign has to answer](#9-questions-the-redesign-has-to-answer)

---

## 1. Method

- Read every JSX component in scope, plus the non-JSX modules that decide
  user-visible behavior:
  - `search/useContentDispatch.js`: where a tap goes
  - `search/resultRowVerbs.js`: what the ⋯ menu does
  - `cast/useDispatchTargetPicker.js`, `peek/useTakeOver.js`,
    `fleet/useFleetSummary.js`
  - the copy tables `shell/stateCopy.js` and `cast/castCopy.js`
  - the responsive visibility rules in `shell/MediaShell.scss`
  - the session `STOP` semantics in `session/sessionReducer.js`
- Wrote each job the way the user would say it, not as a feature name. Traced
  each job to every place in the UI that serves it, and each component to every
  job it carries.
- Rated how each job is *served*, not whether the code works:

| Rating | Meaning |
|---|---|
| **Single** | One obvious place does it. |
| **Scattered** | Several places do it, and they agree. |
| **Inconsistent** | Several places do it, and they behave differently. |
| **Partial** | Only part of the job is supported. |
| **Buried** | It works, but only through a path most people won't find. |
| **Invisible** | No UI. A component carries the job for a person or system that never sees it. |

Much of the current code came out of earlier media audits: 2026-04-15 (cast),
2026-04-19 (UX), 2026-05-15 (usability), 2026-06-09 (lookup), and 2026-07-14
(the "Bluey" incident). This baseline does not re-check whether those fixes
worked. It records where they left the app.

---

## 2. Who uses it, from where

| Actor | Where | Comes to |
|---|---|---|
| Household member on a **phone** | Mobile layout: search launcher, full-screen Search Mode, bottom tab bar | Put something on here or on a TV; check or stop what's playing |
| Household member on a **laptop or tablet** | Tablet+ layout: search bar in the dock, left nav rail, fleet and cast icons | The same, plus longer sessions: building a queue, watching video in the browser |
| **Automation author** (Home Assistant, NFC, wall buttons) | `/media?play=…`, `?queue=…`, WebSocket commands | Start playback in a browser without touching it |
| **Other house surfaces** (dashboards, logs) | WebSocket `playback_state` broadcasts | See what this browser is playing |

The last two actors have no UI in this app, but JSX components carry their
jobs (group J).

---

## 3. The screen as built

```
MOBILE                                    TABLET+
┌──────────────────────────────┐          ┌─────────────────────────────────────────────────┐
│ [🔍 Search media…       ] ⚙ │ dock      │ [All][Video][Music] [search…] Devices 2/5 📡• ⚙ │ dock
├──────────────────────────────┤          ├──────┬──────────────────────────────────────────┤
│                              │          │ Home │                                          │
│  CANVAS — exactly one of:    │          │Browse│  CANVAS — exactly one of:                │
│  Home · Browse · Detail ·    │          │Devs ②│  Home · Browse · Detail · Now Playing ·  │
│  Now Playing · Devices ·     │          │      │  Devices · Remote                        │
│  Remote                      │          │      │                                          │
├──────────────────────────────┤          ├──────┴──────────────────────────────────────────┤
│ cast progress tray (if any)  │          │ cast progress tray (if any)                     │
│ ▬ mini player (if session)   │          │ ▬ mini player (if session)                      │
├──────────────────────────────┤          └─────────────────────────────────────────────────┘
│  Home    Browse    Devices ② │ tab bar
└──────────────────────────────┘
+ Search Mode: full-screen overlay over the canvas
```

`Remote` is the view the code and reference doc call **Peek**. The UI never
uses that word.

**What changes with width**

- **Search.** On mobile, a launcher opens full-screen **Search Mode**
  (`search/SearchMode.jsx`). On tablet+, the search is an inline combobox in
  the dock (`search/MediaContentSearch.jsx` → `Content/combobox/ContentCombobox.jsx`)
  with scope chips beside it.
- **Fleet indicator and cast chip.** "Devices 2/5" and the cast target chip
  are hidden on mobile (`shell/MediaShell.scss:246-249`). The badge on the
  Devices tab is mobile's only fleet signal. Tablet+ shows both the indicator
  and the badge.
- **Cast settings on mobile.** Mobile has no way to see or change cast mode.
  It also cannot switch the destination back to "This browser" once a device
  is picked (§7.1, D2 and D5).
- **Keyboard.** `/` focuses the tablet+ search input
  (`shell/MediaAppShell.jsx:23-34`). On mobile it does nothing. Escape goes back
  one view when no overlay is open.

---

## 4. Job inventory at a glance

Fifty jobs in eleven groups. The ID is used throughout.

### A. Find something

| ID | Job, in the user's words | Served by | Rating |
|---|---|---|---|
| A1 | Find a specific title by typing | Dock search (tablet+), Search Mode (mobile), Devices card **Play…** | Inconsistent |
| A2 | Narrow a search to a kind of content | `ScopeChips` in the dock and Search Mode | Scattered |
| A3 | Know whether the search is finished and trustworthy | `StreamStatusLine`, widening notice, empty and error states | Inconsistent |
| A4 | Browse the catalog without a title in mind | Browse tab → `BrowseView` | Partial |
| A5 | Look inside a show, album, or folder | `BrowseView` opened from a container | Single |
| A6 | Learn more about one item before acting | `DetailView` | Buried |
| A7 | Get back to something I played recently | `RecentsRow` on Home | Partial |

### B. Watch or listen here

| ID | Job | Served by | Rating |
|---|---|---|---|
| B1 | Play this now | Search row tap, ⋯ Play Now, browse row Play Now, Detail Play Now, recents tile | Inconsistent |
| B2 | Pick up where I left off | Session persistence, `ResumeCard`, `MiniPlayer` | Scattered |
| B3 | See what's playing here from anywhere in the app | `MiniPlayer` | Single |
| B4 | Pause, resume, skip | `MiniPlayer`, `TransportBar` | Scattered |
| B5 | Scrub, jump 10s, change speed or volume | `SeekBar`, `TransportBar` (Now Playing only) | Single |
| B6 | Watch the video big | `NowPlayingView` host, mini player video dock | Single |
| B7 | Make it stop | Mini player Stop, transport Stop, Settings → Reset session | Scattered |

### C. Line things up

| ID | Job | Served by | Rating |
|---|---|---|---|
| C1 | Play this right after the current thing | ⋯ Play Next / Up Next, Detail Play Next / Up Next | Buried |
| C2 | Add to the end without interrupting | ⋯ Add to Queue, browse row Add, Detail Add to Queue | Scattered |
| C3 | Play a whole show, album, or playlist | Container ▶ in search, browse header Play | Scattered |
| C4 | Shuffle a whole show or album | Browse header Shuffle, shuffle toggles | Scattered |
| C5 | See, reorder, jump within, remove from, or clear the queue | `QueuePanel` in Now Playing | Buried |
| C6 | Repeat one item or the whole queue | `TransportBar` and `QueuePanel`, on the same screen | Scattered |

### D. Choose where it plays

| ID | Job | Served by | Rating |
|---|---|---|---|
| D1 | Know where a tap will go before I tap | `DestinationLine` (two surfaces only), dot on the cast chip | Partial |
| D2 | Point my taps at a TV for a while, then back | `CastTargetChip` (tablet+), `DestinationLine` sheet | Inconsistent |
| D3 | Send this one item to a device without changing my default | Detail → **Cast** | Buried |
| D4 | Send to several devices at once | Picker "+ cast to more than one", chip checkboxes | Buried |
| D5 | Decide whether this browser keeps playing when I send | Chip radios (tablet+), picker mode toggle | Inconsistent |

### E. Cast with confidence

| ID | Job | Served by | Rating |
|---|---|---|---|
| E1 | See that the cast is progressing (TV waking, loading) | `DispatchProgressTray`, confirmation toast | Scattered |
| E2 | Know that it actually started playing | `DispatchProgressTray` confirmed or unconfirmed row | Single |
| E3 | Retry a cast that failed | Tray **Retry**, failure-toast **Retry** | Inconsistent |
| E4 | Jump from a cast to controlling it | Tray **Remote** button | Buried |

### F. Know what's playing around the house

| ID | Job | Served by | Rating |
|---|---|---|---|
| F1 | Glance at whether anything is playing anywhere | `FleetIndicator` (tablet+), Devices tab badge | Scattered |
| F2 | See what each device is doing | `FleetView` cards | Single |
| F3 | Tell whether that information is current | "Out of date" badge, "Off — last seen…", "Not reporting" | Single |
| F4 | See a device's state while choosing where to cast | `DispatchTargetPicker` tiles, busy warning | Single |

### G. Control another device

| ID | Job | Served by | Rating |
|---|---|---|---|
| G1 | Play, pause, stop, or skip on a device | `PeekPanel` | Single |
| G2 | Seek or change volume on a device | `PeekPanel` (`SeekBar` + slider) | Partial |
| G3 | See and edit a device's queue | `QueuePanel` inside `PeekPanel` | Single |
| G4 | Put something on a specific device | Four separate paths (§5-G4) | Inconsistent |
| G5 | Add to a device's queue without replacing what's on | Browse header **Queue** with a device destination | Partial |

### H. Move playback between screens

| ID | Job | Served by | Rating |
|---|---|---|---|
| H1 | Bring what's on the TV to this browser | Devices card **Play here** | Buried |
| H2 | Send what's playing here to a TV, where it left off | Now Playing → "Send to another device" | Buried |

### I. Trust it

| ID | Job | Served by | Rating |
|---|---|---|---|
| I1 | Don't lose my place on reload or crash | `LocalSessionProvider` persistence | Invisible |
| I2 | Start from a clean slate | Settings → Reset session → confirm | Buried |
| I3 | Don't get the page reloaded by a server blip | `MediaApp.jsx` auto-reload suppression | Invisible |
| I4 | Be told when playback fails | Now Playing state line only | Partial |

### J. Automations and observers (no UI)

| ID | Job | Served by | Rating |
|---|---|---|---|
| J1 | Start playback in a browser from an automation | `SessionSideEffects` → `useUrlCommand`, `useExternalControl` | Invisible |
| J2 | Let the house see what this browser is playing | `SessionSideEffects` → `usePlaybackStateBroadcast`, unload broadcast | Invisible |
| J3 | Identify this browser by name | `ClientIdentityProvider` | Partial |

### K. Get around

| ID | Job | Served by | Rating |
|---|---|---|---|
| K1 | Move between areas | `NavRail` / `TabBar` | Single |
| K2 | Go back | Browser Back, "← Back", "← Devices", breadcrumb, Escape | Scattered |
| K3 | Get to Now Playing and the queue | Mini player title or video dock only | Buried |

**Tally:** 11 Single · 11 Scattered · 7 Inconsistent · 7 Partial · 10 Buried ·
4 Invisible. Six of the seven Inconsistent jobs are in groups A, B, D, and G:
finding, playing, choosing a destination, and controlling another device. Ten
jobs are Buried, including both ways of moving playback between screens.

---

## 5. Jobs in detail

Each job lists the paths that reach it, what happens, and what stands out when
you look at it as a user.

### A. Find something

**A1 — Find a specific title by typing.** *Inconsistent.*
- **Tablet+:** type in the dock combobox. Results stream in. Tapping a row
  plays a playable item at the current destination; tapping a container opens
  it in Browse. Containers have a trailing ▶, playable items a trailing ⋯
  (`Content/combobox/ResultRow.jsx`).
- **Mobile:** launcher → Search Mode. Same row behavior. A local play shows a
  "Playing X" toast and closes the surface (`search/SearchMode.jsx:116-126`).
- **Devices card → Play…:** a third search box inline on the card
  (`fleet/FleetPlayPicker.jsx`). It runs on a different search hook
  (`useLiveSearch`), has no scopes, no ▶ or ⋯, and a tap sends *anything*,
  containers included, to that device.
- **Stands out:**
  - Three search UIs on two search engines, each with its own row grammar.
  - A tablet+ row tap that plays locally gives **no** toast
    (`search/MediaContentSearch.jsx:48-58`). The same tap on mobile does.

**A2 — Narrow a search to a kind of content.** *Scattered.*
- `ScopeChips` sits in the tablet+ dock row and at the top of Search Mode. A
  parent chip with children opens a second row. A parent with no search
  parameters of its own only groups; it can't be selected.
- A scoped search that comes up empty widens to All automatically and says so
  ("Nothing in Ambient — showing 12 results from everywhere").
- **Stands out:**
  - Scope resets to All every time Search Mode opens. Tablet+ keeps the chosen
    scope until the page reloads. It is never saved across reloads
    (`search/SearchProvider.jsx:3-5`).
  - Devices-card search has no scopes at all.

**A3 — Know whether the search is finished and trustworthy.** *Inconsistent.*
- Dock and Search Mode share `StreamStatusLine` ("Searching 5 sources…",
  "Plex didn't answer · Retry").
- The widening notice is written twice, once in `ContentCombobox` and once in
  `SearchMode`.
- Devices-card search uses its own "Searching… / Still searching…" lines, plus
  `SearchEmptyState` and `SearchErrorState`. It is the only user of those two
  components.
- **Stands out:** three renderings of the same progress and failure states.

**A4 — Browse the catalog without a title in mind.** *Partial.*
- Browse tab → `BrowseView` at the List API root (`shell/PrimaryNav.jsx:13`).
  A container row drills in. A playable row offers its title (→ Detail),
  **Play Now**, and **Add**. "Load more (N remaining)" pages.
- **Stands out:**
  - Browse rows have no thumbnails. They are title text only
    (`browse/BrowseView.jsx:152,162`).
  - The breadcrumb is Home / ← Back / current label, not a trail.
  - Home no longer shows category cards, so the raw root list is the only
    no-typing way into the catalog. Nothing reads the `browse:` entries in the
    media config any more (§8).

**A5 — Look inside a show, album, or folder.** *Single.*
- A container tap in either search, or a container row in Browse, opens
  `BrowseView` with that container. The view gets a header with **Play**,
  **Shuffle**, and **Queue** for the whole container, plus a `DestinationLine`.
- **Stands out:**
  - The header appears only when a specific container was opened. Root and
    category levels have none.
  - The header obeys the destination, but the **Play Now / Add** buttons on
    the rows directly beneath it always act locally. The screen can say
    "Playing to: Living Room TV" above row buttons that ignore it (§7.1).

**A6 — Learn more about one item before acting.** *Buried.*
- `DetailView`: poster, title, description, **Play Now**, **Play Next**,
  **Up Next**, **Add to Queue**, **Cast**.
- Reached only by tapping a playable row's title in Browse, or ⋯ → Open detail
  in search. A search row tap never opens it.
- **Stands out:**
  - No destination line. The four queue buttons always act locally and give
    no confirmation.
  - **Cast** is the only per-item cast button anywhere in the app (§5-D3).

**A7 — Get back to something I played recently.** *Partial.*
- `RecentsRow` on Home: a horizontal strip of tiles. A tap plays the item now,
  here, and replaces the queue (`browse/RecentsRow.jsx:43`).
- **Stands out:**
  - Only items played *in this browser* are recorded
    (`session/attachments.js:53`). Anything cast to a TV never shows up.
  - A tile has one action: replace-and-play locally. It ignores the
    destination, and there is no add, cast, or detail option.

### B. Watch or listen here

**B1 — Play this now.** *Inconsistent.*
Six affordances. Only some of them obey the destination; the full list is in
§7.1. A search row tap follows the destination, but ⋯ → Play Now on the same
row always plays locally.

**B2 — Pick up where I left off.** *Scattered.*
- A reload restores item, position, queue, shuffle/repeat, and volume
  (group I1).
- Home shows `ResumeCard` (title, "at 12:34", **Resume**) and the mini player
  shows the same item.
- **Stands out:** `ResumeCard` hides only when the session is idle
  (`browse/ResumeCard.jsx:19`). It keeps offering **Resume** while the item is
  already playing.

**B3 — See what's playing here from anywhere.** *Single.*
- `MiniPlayer` is a bottom bar on every view: progress strip; a thumbnail (or,
  for video, a small live picture); title with "3/12"; play/pause, next, stop.
  It renders nothing when there's no current item.

**B4 — Pause, resume, skip.** *Scattered.*
- `MiniPlayer` everywhere; `TransportBar` in Now Playing.
- **Stands out:** the mini player is still shown on Now Playing
  (`shell/MediaAppShell.jsx:45`; it only gets a highlight there). Now Playing
  therefore shows two play/pause buttons, two next buttons, and two stop
  buttons at once.

**B5 — Scrub, jump 10s, change speed or volume.** *Single.*
- Now Playing only.
  - `SeekBar`: drag or keyboard; a LIVE badge for live items.
  - `TransportBar` main row: prev, −10s, play/pause, +10s, next.
  - `TransportBar` second row: shuffle, repeat, speed, volume, stop.
- **Stands out:** speed drives the page's `<video>`/`<audio>` element directly
  and is local only (`shell/TransportBar.jsx:41-77`). Volume is a drag
  slider.

**B6 — Watch the video big.** *Single.*
- Video renders in the Now Playing host. On other views, a video session shows
  as a small live picture in the mini player; a tap expands it. Audio has no
  visual outside Now Playing.

**B7 — Make it stop.** *Scattered.*
- Three controls with different scope and wording:
  - Mini player **Stop** (tooltip "Stop and clear current item")
  - `TransportBar` **Stop**
  - Settings → **Reset session**, which confirms before clearing queue and
    position
- **Stands out:** Stop keeps the queue (`session/sessionReducer.js:84-93`) but
  clears the current item. That removes the mini player, which is the only UI
  route to the queue (K3). After Stop, a queued list is still there but out of
  reach.

### C. Line things up

**C1 — Play this right after the current thing.** *Buried.*
- ⋯ menu on search rows and Detail offer both **Play Next** and **Up Next**.
  Up Next items carry an "up next" badge in the queue.
- **Stands out:**
  - Nothing in the UI explains how the two verbs differ.
  - Browse rows offer neither.
  - Both are always local, even when a device destination is showing.

**C2 — Add to the end without interrupting.** *Scattered.*
- ⋯ **Add to Queue** (search), **Add** (browse rows), **Add to Queue**
  (Detail). **Queue** in the browse container header adds the whole container
  and obeys the destination.
- **Stands out:** no add gives a confirmation. `notifications.show` is called
  only in search dispatch, cast routing, and take-over failure. The mini
  player's "n/m" counter is the only sign an add landed, and it appears only
  once the queue has two or more items.

**C3 — Play a whole show, album, or playlist.** *Scattered.*
- Container ▶ on search rows (labelled "Play as queue" for screen readers) and
  **Play** in the browse header. Both obey the destination.
- **Stands out:** a local play-all toasts in Search Mode and from the dock ▶.
  From the browse header it does not.

**C4 — Shuffle a whole show or album.** *Scattered.*
- Browse header **Shuffle** turns on session shuffle and plays the container,
  or casts it with shuffle on. There are also shuffle toggles in
  `TransportBar` and `QueuePanel`.
- **Stands out:** search rows have no shuffle verb; you have to browse in
  first.

**C5 — See, reorder, jump within, remove from, or clear the queue.** *Buried.*
- `QueuePanel` in Now Playing:
  - toolbar: item count, **Shuffle**, **Repeat**, **Clear**
  - per item: tap to jump, ↑ / ↓ to reorder, ✕ to remove
- **Stands out:**
  - No nav entry. The only way in is through the mini player (K3).
  - **Clear** has no confirmation; **Reset session** does.

**C6 — Repeat one item or the whole queue.** *Scattered.*
- Repeat cycles off → all → one. It is an icon in `TransportBar` and a
  labelled button in `QueuePanel`, and both are on Now Playing at once. Shuffle
  is duplicated the same way.

### D. Choose where it plays

**D1 — Know where a tap will go before I tap.** *Partial.*
- `DestinationLine` ("▶ Playing to: This browser / Living Room TV / 2
  devices") appears in only two places: Search Mode and the browse container
  header.
- **Stands out:**
  - Tablet+ dock search has no destination line, only an amber dot on the cast
    icon.
  - Detail, browse rows, and recents show nothing. They always act locally, but
    a user who has aimed at the TV can't tell that.
  - **In the Remote view the line names the wrong destination.** Search taps
    there go to the device being controlled (`search/useContentDispatch.js:187-190`).
    The line only reads the saved cast target (`cast/DestinationLine.jsx:26-48`),
    so on mobile it can say "This browser" while the tap goes to the TV.

**D2 — Point my taps at a TV for a while, then back.** *Inconsistent.*
- **Tablet+:** cast chip popover (`cast/CastTargetChip.jsx`) with "When
  casting" radios and "Preferred targets" checkboxes (names only).
- **Mobile, and anywhere the line shows:** tap `DestinationLine` → a modal with
  `DispatchTargetPicker` tiles (icon, room, live status), "+ add another
  device", and **Set destination: X**.
- Both write the same saved state.
- **Stands out:**
  - The two UIs look nothing alike.
  - **The sheet cannot choose "This browser".** Its button needs at least one
    device selected (`cast/useDispatchTargetPicker.js:385`). The only control
    that clears targets is unticking boxes in the chip, and the chip is hidden
    on mobile.
  - So on a phone, once a TV is picked, every search row tap casts there for
    good. Reset session doesn't clear it either. The one local escape is ⋯ →
    Play Now, which ignores the destination (§7.1).

**D3 — Send this one item to a device without changing my default.** *Buried.*
- Only `DetailView` has a per-item **Cast** button (`cast/CastButton.jsx` is
  mounted nowhere else). It opens the picker with the saved targets
  preselected.
- **Stands out:** search and browse rows have no per-item cast. The reference
  doc still says every search result row carries one (§8).

**D4 — Send to several devices at once.** *Buried.*
- In the picker: "+ cast to more than one" (casting) or "+ add another device"
  (destination sheet). The chip's checkboxes allow several targets by default.

**D5 — Decide whether this browser keeps playing when I send.** *Inconsistent.*
- **Tablet+:** chip radios set the default for row taps ("Move playback to the
  device" / "Keep playing here too").
- **Picker:** shows a Move / Keep toggle only when something is playing locally,
  and never in the destination sheet (`cast/DispatchTargetPicker.jsx:124`).
- **Stands out:**
  - Mobile has no chip, so row-tap casts use the saved mode, default "Move".
    Move stops local playback once the cast succeeds
    (`cast/DispatchProvider.jsx:115-117`), and on mobile that can't be seen or
    changed.
  - Remote-view search and Devices-card **Play…** always keep local playback
    going, and never say so.

### E. Cast with confidence

**E1 — See that the cast is progressing.** *Scattered.*
- A tray row: spinner, "Casting Bluey to Living Room TV", and a step label
  ("Turning on TV…", "Preparing video…").
- Casts routed from a destination (search taps, browse header) also get a
  blue toast: "Casting Bluey · To Living Room TV".
- **Stands out:** picker casts (Detail **Cast**, hand-off, Devices-card
  **Play…**) get the tray row only, no toast. Destination-routed casts get
  both.

**E2 — Know that it actually started playing.** *Single.*
- The tray row moves "Sent to X" → "▶ Playing on X" and lingers 8s with a
  **Remote** button. If playback isn't confirmed, it reads "The TV may not have
  started playing — check it or open the remote" and stays until dismissed.
- **Stands out:** the copy says "TV" whatever the device is
  (`cast/DispatchProgressTray.jsx:55`).

**E3 — Retry a cast that failed.** *Inconsistent.*
- The tray row shows "Couldn't cast to X · Stopped while turning on TV" with
  **Retry** and dismiss. Destination-routed casts also raise a red toast with
  its own **Retry**.
- **Stands out:** every Retry, in every row and every toast, re-sends the
  **most recent cast attempt**, not the one it sits next to
  (`cast/DispatchProvider.jsx:142-146`; the tray hands the same `retryLast` to
  each row). With two failed rows, Retry on the older one re-sends the newer
  one.

**E4 — Jump from a cast to controlling it.** *Buried.*
- Tray **Remote** on confirmed or unconfirmed rows opens the Remote view.
- **Stands out:** confirmed rows clear after 8s, and the shortcut goes with
  them. After that the path is Devices → card → **Remote**.

### F. Know what's playing around the house

**F1 — Glance at whether anything is playing anywhere.** *Scattered.*
- "Devices active/total" in the tablet+ dock, plus an active-count badge on the
  Devices tab or rail item at every width. "Active" means playing, paused,
  buffering, or stalled (`fleet/useFleetSummary.js:7`).
- **Stands out:** tablet+ shows the same number twice.

**F2 — See what each device is doing.** *Single.*
- `FleetView`, one card per device: state dot, icon, name, room, state label,
  and either now-playing (thumbnail, title, progress) or a hint ("This device
  hasn't reported yet" / "Nothing playing right now").
- Actions: **Remote**, **Play…**, and **Play here** when the device is active.

**F3 — Tell whether that information is current.** *Single.*
- "Out of date" badge when the live connection drops; "Off — last seen
  playing"; "Not reporting". The Remote view repeats the badges.

**F4 — See a device's state while choosing where to cast.** *Single.*
- Picker tiles read "Playing: Bluey — 12:03 left", "Paused: X", "Idle", or
  "Off". Selecting a busy device warns "X is playing Bluey — casting will
  replace it".

### G. Control another device

**G1 — Play, pause, stop, or skip on a device.** *Single.*
- `PeekPanel`: "← Devices", staleness/offline badges, device name with icon and
  room, a status line, and separate **Play / Pause / Stop / Prev / Next**
  buttons. A button locks while the device confirms.

**G2 — Seek or change volume on a device.** *Partial.*
- Shared `SeekBar`, plus a drag slider for volume with a number beside it.
- **Stands out:**
  - No ±10s and no speed.
  - Shuffle and repeat live only in the queue panel, not the transport.
  - The controls are laid out differently from local Now Playing (§7.2).

**G3 — See and edit a device's queue.** *Single.*
- The same `QueuePanel` as Now Playing, pointed at the device.

**G4 — Put something on a specific device.** *Inconsistent.*
- Four paths, each with its own search UI, mode, and feedback:

| Path | Search UI | Mode | Feedback |
|---|---|---|---|
| Devices → card → **Play…** → tap result | Inline `FleetPlayPicker` (no scopes) | Always keep local | Tray only |
| Open **Remote**, then use dock search or Search Mode | Normal search | Always keep local | Tray only; destination line is wrong (D1) |
| Set destination, then tap in search or the browse header | Normal search | Saved chip mode | Toast + tray |
| Detail → **Cast** → pick device | Picker | Move/Keep toggle if playing locally | Tray only |

**G5 — Add to a device's queue without replacing what's on.** *Partial.*
- Only the browse container header's **Queue**, with a device destination,
  appends to a device.
- **Stands out:**
  - No single item can be appended to a device from anywhere. ⋯ verbs are local
    only, even in the Remote view.
  - Opening a container from the Remote view navigates to Browse, and the app
    forgets which device was being controlled. The header then follows the
    saved destination instead (§7.6).

### H. Move playback between screens

**H1 — Bring what's on the TV to this browser.** *Buried.*
- Devices card → **Play here**, shown only while the device is active. A
  failure raises a red toast. Success has no message: the device stops and
  the local mini player appears.
- **Stands out:** the Remote view for that device doesn't offer it.

**H2 — Send what's playing here to a TV, where it left off.** *Buried.*
- Now Playing, below the queue: "Send to another device" with an always-open
  picker, **Hand off to X**, and the Move / Keep toggle.
- **Stands out:** not offered from the mini player, Devices, or Remote. You
  have to know to open Now Playing and scroll past the queue.

### I. Trust it

**I1 — Don't lose my place on reload or crash.** *Invisible.*
- The session (item, position, queue, config) is saved to local storage and
  restored on load. Navigation history restores the view stack. The cast
  destination and mode are saved too; search scope is not.

**I2 — Start from a clean slate.** *Buried.*
- Settings gear → **Reset session** → "Reset local session? This clears the
  current queue and playback position. This cannot be undone."
- **Stands out:** it is the only item in Settings. It doesn't reset the
  destination, cast mode, or recents.

**I3 — Don't get the page reloaded by a server blip.** *Invisible.*
- `MediaApp.jsx:48-50` suppresses the WebSocket service's auto-reload while the
  app is mounted.

**I4 — Be told when playback fails.** *Partial.*
- The session moves past failed items on its own. The only place a person sees
  it is the Now Playing state line ("Having trouble streaming — hang on",
  "Something went wrong").
- **Stands out:** no toast or banner for playback failure, and nothing on the
  mini player.

### J. Automations and observers

**J1 — Start playback in a browser from an automation.** *Invisible.*
- `SessionSideEffects` (inside `LocalSessionProvider`) runs the URL-command
  handler (`?play=`, `?queue=`, once per token) and the inbound WebSocket
  control handler.

**J2 — Let the house see what this browser is playing.** *Invisible.*
- `usePlaybackStateBroadcast` publishes `playback_state`, and a `beforeunload`
  handler publishes `stopped` when the tab closes.

**J3 — Identify this browser by name.** *Partial.*
- `ClientIdentityProvider` creates a persistent `clientId` and reads a display
  name from storage.
- **Stands out:** nothing in the app writes that name, so every browser
  reports "Client 1a2b3c4d".

### K. Get around

**K1 — Move between areas.** *Single.*
- Home / Browse / Devices. Detail highlights Browse, Remote highlights
  Devices, and Now Playing highlights nothing (the mini player lights up).
- **Stands out:** tapping the tab you're already on still adds a history entry
  (`shell/PrimaryNav.jsx:37`), so Back then takes extra presses.

**K2 — Go back.** *Scattered.*
- Browser Back and in-app back do the same thing.
- Buttons: "← Back" on Now Playing, "← Devices" on Remote, breadcrumb
  **Home** and **← Back** in Browse. Escape also goes back when no overlay is
  open.
- Search Mode takes one Back to close.
- **Stands out:** "← Devices" returns to the previous view, not to Devices.
  After arriving from the tray's **Remote**, it goes wherever you were before.

**K3 — Get to Now Playing and the queue.** *Buried.*
- Only the mini player's title or video dock opens Now Playing, and the mini
  player exists only while there's a current item.
- **Stands out:** after Stop, or after a "Move playback" cast, the queue still
  exists but no UI reaches it (B7).

---

## 6. Component → job index

Every JSX component in scope, grouped by what kind of thing it is. The last
column counts distinct job groups a component serves: a rough measure of how
many concerns it mixes.

### 6.1 Persistent chrome (always on screen)

| Component | Renders where | Jobs | Groups |
|---|---|---|---|
| `shell/MediaAppShell.jsx` | Root layout; mounts Search Mode; `/` shortcut | K1, K2, A1 | 2 |
| `shell/Dock.jsx` | Top bar | A1, A2, D2, F1, I2 | 5 |
| `shell/PrimaryNav.jsx` → `NavRail`, `TabBar` | Left rail (tablet+) / bottom tabs (mobile) | K1, F1 (badge) | 2 |
| `shell/FleetIndicator.jsx` | Dock, tablet+ | F1, K1 | 2 |
| `cast/CastTargetChip.jsx` | Dock, tablet+ | D1 (dot), D2, D4, D5 | 1 |
| `shell/SettingsMenu.jsx` | Dock gear | I2 | 1 |
| `shell/ConfirmDialog.jsx` | Modal from Settings | I2 | 1 |
| `shell/MiniPlayer.jsx` | Bottom bar when a session has a current item | B3, B4, B6, B7, K3 | 2 |
| `cast/DispatchProgressTray.jsx` | Above the mini player while casts are in flight | E1, E2, E3, E4 | 1 |

### 6.2 Canvas views (one at a time)

| Component | View | Jobs | Groups |
|---|---|---|---|
| `shell/Canvas.jsx` | Switches views by URL state | K1 | 1 |
| `browse/HomeView.jsx` | Home | B2, A7 | 2 |
| `browse/ResumeCard.jsx` | Home | B2 | 1 |
| `browse/RecentsRow.jsx` | Home | A7, B1 | 2 |
| `browse/BrowseView.jsx` | Browse | A4, A5, B1, C2, C3, C4, D1, K2 | 5 |
| `browse/DetailView.jsx` | Detail | A6, B1, C1, C2, D3 | 4 |
| `shell/NowPlayingView.jsx` | Now Playing | B4, B5, B6, C5, C6, H2, I4 | 4 |
| `shell/FleetView.jsx` (incl. `FleetCard`) | Devices | F1, F2, F3, G4, H1 | 3 |
| `shell/PeekPanel.jsx` | Remote | G1, G2, G3, F3, K2 | 3 |

### 6.3 Overlays, pickers and sheets

| Component | Opened from | Jobs | Groups |
|---|---|---|---|
| `search/SearchMode.jsx` | Mobile launcher | A1, A2, A3, A5, B1, C1, C2, C3, D1 | 4 |
| `cast/DestinationLine.jsx` | Search Mode, browse container header | D1, D2 | 1 |
| `cast/DispatchTargetPicker.jsx` | CastButton, DestinationLine sheet, Now Playing hand-off | D2, D3, D4, D5, F4, H2 | 3 |
| `cast/CastButton.jsx` | Detail only | D3 | 1 |
| `fleet/FleetPlayPicker.jsx` | Devices card **Play…** | A1, A3, G4 | 2 |

### 6.4 Embedded controls

| Component | Mounted in | Jobs | Groups |
|---|---|---|---|
| `search/MediaContentSearch.jsx` | Dock (tablet+) | A1, A2, A5, B1, C1, C2, C3 | 4 |
| `Content/combobox/ContentCombobox.jsx` *(shared)* | MediaContentSearch | A1, A3 | 1 |
| `Content/combobox/ResultRow.jsx` *(shared)* | Search Mode rows, combobox rows (actions only) | A5, A6, B1, C1, C2, C3 | 3 |
| `Content/combobox/StreamStatusLine.jsx` *(shared)* | Combobox, Search Mode | A3 | 1 |
| `search/ScopeChips.jsx` | Dock search, Search Mode | A2 | 1 |
| `search/SearchEmptyState.jsx` | FleetPlayPicker only | A3 | 1 |
| `search/SearchErrorState.jsx` | FleetPlayPicker only | A3 | 1 |
| `shell/SeekBar.jsx` | Now Playing, Remote | B5, G2 | 2 |
| `shell/TransportBar.jsx` | Now Playing only | B4, B5, B7, C4, C6 | 2 |
| `shell/QueuePanel.jsx` | Now Playing, Remote | C4, C5, C6, G3 | 2 |

### 6.5 Invisible components (providers and bridges)

These render no UI of their own, but each one carries a user or system job, or
decides behavior the user sees.

| Component | Job it carries | Behavior a user sees |
|---|---|---|
| `Apps/MediaApp.jsx` | I3, session logging | Page isn't reloaded by a backend outage; dark theme; toasts bottom-center |
| `identity/ClientIdentityProvider.jsx` | J3 | None (no name UI) |
| `session/LocalSessionProvider.jsx` (+ `SessionSideEffects`) | I1, J1, J2 | Reload resumes; automations can start playback |
| `session/PlayerHostProvider.jsx` | B6 | Picks where the player is drawn (hidden, mini player dock, Now Playing) |
| `session/PlayerBridge.jsx` | B1–B6 | Audio keeps playing across navigation; start-at-position; volume; stall detection |
| `fleet/FleetProvider.jsx` | F1–F4 | Device list refreshes on tab focus; "Out of date" on disconnect |
| `peek/PeekProvider.jsx` | G1–G3 | Remote commands confirm or time out |
| `cast/CastTargetProvider.jsx` | D1, D2, D5 | Saves destination and mode per browser |
| `cast/DispatchProvider.jsx` | E1–E3, D5 | Duplicate-tap protection; "Move" stops local playback on success; Retry re-sends the last attempt |
| `search/SearchProvider.jsx` | A2 | Scope tree from household config; resets to All |
| `shell/NavProvider.jsx` | K1, K2 | Views live in the URL; Back/refresh/share restore them |
| `shell/DismissStackProvider.jsx` | K2 | Escape closes the top overlay, else goes back |

---

## 7. Cross-cutting evaluation

These are the places where the current UX mixes concerns. The groupings follow
the separation-of-concerns lens the redesign will use.

### 7.1 Where does a tap go? The destination matrix

"Destination" is one concept: this browser, a device, or several devices. Four
UIs set it (`CastTargetChip`, the `DestinationLine` sheet, per-item
`DispatchTargetPicker`, `FleetPlayPicker`), and one hidden rule overrides it
(being in the Remote view). This is how every play/add affordance behaves when
a TV is the saved destination:

| Affordance | Surface | Obeys saved destination? | Destination shown on screen? |
|---|---|---|---|
| Row tap, playable item | Dock search, Search Mode | **Yes** (Remote view: goes to that device instead) | Search Mode only |
| Row tap, container | Dock search, Search Mode | n/a (browses) | — |
| ▶ on container row | Dock search, Search Mode | **Yes** | Search Mode only |
| ⋯ Play Now / Play Next / Up Next / Add | Dock search, Search Mode | **No, always local** | Search Mode shows the TV above them |
| Header Play / Shuffle / Queue | Browse (container) | **Yes** (but Remote context is lost, §7.6) | Yes |
| Row **Play Now** / **Add** | Browse | **No, always local** | Same screen shows the TV |
| **Play Now / Play Next / Up Next / Add to Queue** | Detail | **No, always local** | No |
| **Cast** | Detail | Explicit picker, preselected | In picker |
| Tile tap | Home recents | **No, always local** | No |
| **Resume** | Home | Local | No |
| **Play…** result | Devices card | That device, always keep local | Card context |
| **Hand off to X** | Now Playing | Explicit picker, preselected | In picker |
| **Play here** | Devices card | Local (take over) | Button label |

In short, the same verb ("Play Now") sends to the TV from one control and plays
locally from the control beside it. Where-it-plays is a concern that currently
lives inside each individual button.

### 7.2 One job, several implementations

| Job | Implementations | Differences a user can see |
|---|---|---|
| Search (A1/A3) | Dock combobox · Search Mode · Devices-card Play… | Scopes, row actions, containers, progress copy, toasts |
| Transport (B4/G1) | `MiniPlayer` · `TransportBar` · `PeekPanel`'s own buttons | Toggle vs. separate Play and Pause; ±10s local only; speed local only; native slider vs. Mantine slider for volume |
| Shuffle / repeat (C4/C6) | `TransportBar` · `QueuePanel` (both on Now Playing) · browse header Shuffle | Icon vs. labelled button on the same screen |
| Stop / clear (B7) | Mini Stop · transport Stop · queue Clear (no confirm) · Reset session (confirm) | Different scope, different confirmation |
| Choose device (D2–D4, G4) | Chip checkboxes · picker tiles · Devices card · Remote context | Names only vs. icon, room, and live status; multi-select by default vs. opt-in |
| Cast feedback (E1/E3) | Tray row · blue/red toasts | Toasts only for destination-routed casts; two Retry buttons |
| Search empty/error (A3) | `ContentCombobox` inline · `SearchMode` inline · `SearchEmptyState`/`SearchErrorState` | Wording and retry placement |

The reference doc says transport and queue panels are written once and bound
to either the local or the remote session. As built, only `SeekBar` and
`QueuePanel` are. Remote builds its own transport row.

### 7.3 Components carrying many concerns

| Component | Job groups | What's mixed |
|---|---|---|
| `Dock` | 5 | Search, scope, fleet status, destination, session reset |
| `BrowseView` | 5 | Catalog navigation, local playback, container playback at the destination, queueing, destination display |
| `NowPlayingView` | 4 | Video surface, transport, queue editing, hand-off to another device |
| `SearchMode` / `MediaContentSearch` | 4 | Finding, playing, queueing, destination |
| `DetailView` | 4 | Information, local playback, queueing, casting |
| `FleetView` card | 3 | Observing, remote-control entry, starting content on the device (with its own search), take-over |

### 7.4 Confirmation: did my tap do anything?

`notifications.show` is called in exactly four modules:
`search/SearchMode.jsx`, `search/MediaContentSearch.jsx`,
`search/useContentDispatch.js`, and `shell/FleetView.jsx`.

| Action | Confirmation |
|---|---|
| Search row tap, local (mobile) | Toast |
| Search row tap, local (tablet+) | **None** |
| Container ▶ from search, local | Toast |
| Browse header Play / Shuffle / Queue, local | **None** |
| Any ⋯ queue verb, browse Play Now / Add, Detail buttons, recents tile | **None**, apart from the player starting or the "n/m" counter changing |
| Destination-routed cast | Toast + tray |
| Picker cast, Devices-card Play…, hand-off | Tray only |
| Take over succeeded / failed | None / red toast |
| Playback failure | Now Playing state line only |

### 7.5 Vocabulary

The same concepts reach the screen under different words:

| Concept | Words on screen |
|---|---|
| Sending content to a device | Cast · Casting · Send to another device · Hand off · Play on *X*… · Playing to · Set destination · Adding *X* to queue |
| Where taps go | Playing to · Destination · Preferred targets · Cast target (aria) |
| Stop local vs. keep playing | Move playback to the device · Move playback to *X* · Keep playing here too |
| Controlling a device | Remote · (Peek in code and docs) |
| The device list | Devices · Devices 2/5 · ← Devices |
| Pulling a session here | Play here · "Couldn't move playback here" |
| Starting something | Play · Play Now · Play… · Resume · Play as queue (▶) |
| Inserting next | Play Next · Up Next · "up next" badge |

### 7.6 Context that doesn't survive

- **Remote → Browse.** Opening a container from search while in the Remote
  view switches the canvas to Browse. The app stops treating that device as
  the target, so the header's Play / Queue go to the saved destination
  instead.
- **Stop → queue.** Stop keeps the queue but removes the mini player, the only
  route into it (B7, K3).
- **Scope.** Reset every time Search Mode opens; kept on tablet+ until reload;
  never saved across reloads.
- **Tray Remote shortcut.** Gone 8s after a confirmed cast.
- **Destination on mobile.** The opposite problem: it survives too well. It
  can't be cleared back to This browser (D2).

---

## 8. Reference-doc drift

`docs/reference/media/media-app.md` had statements that no longer matched the
code. The **factual** ones were corrected in this pass:

| Doc said | As built | Fixed |
|---|---|---|
| Home has config-driven category cards; `browse` config entries become home cards | Cards removed (`browse/HomeView.jsx:2-5`); nothing reads `browse` | Yes |
| Every search result row carries queue actions + cast | Rows carry tap, ▶ (containers) or ⋯ (leaves); per-item Cast is Detail only | Yes |
| Dock carries the mini player | Mini player is a bottom bar on every width, with next as well as play/pause/stop | Yes |
| Settings menu has client identity | Settings has Reset session only; the display name has no UI | Yes |
| Fleet cards offer Peek and Take Over | Cards offer **Remote**, **Play…**, and **Play here** | Yes |
| Browse view description | Now includes the container header (Play / Shuffle / Queue) | Yes |
| "Have the app remember my last scope" (user story) | Deliberately never saved; resets to All (spec D1) | Yes (story updated to match that decision) |

**Intent statements left unchanged** because they describe goals. As built,
the app falls short of each:
- "Instant visual confirmation" for the four queue actions (§7.4).
- "Tell me" when playback fails and moves on (I4).
- "Panels are written once against the controller interface": true only for
  `SeekBar` and `QueuePanel` (§7.2).
- "The cast target chip governs the search bar": it governs row taps, not the
  ⋯ verbs (§7.1).

---

## 9. Questions the redesign has to answer

These come straight out of the findings above. They are not proposals.

1. **Where does "where it plays" live?** Is destination a mode of the whole app,
   a choice at the moment of each action, or both? Whichever, every play/add
   affordance has to agree (§7.1).
2. **Is Remote a destination or a place?** Today it's a view that silently
   changes what search taps do.
3. **One search or several?** Should adding to a device's queue and playing on
   a device use the same search as local playback?
4. **Where does the queue live?** It is now reachable only through the mini
   player, and it becomes unreachable after Stop.
5. **What is Home for?** It currently holds only resume and recents, and both
   largely duplicate the mini player.
6. **One transport, bound to any session?** Or is remote control deliberately
   a different interaction?
7. **What deserves confirmation?** Right now confirmation depends on which
   control you used, not on what happened.
8. **Which vocabulary wins?** Cast, send, or hand off; Remote or Peek; Play Next
   or Up Next (§7.5).
