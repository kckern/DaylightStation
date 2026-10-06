# Media App — Intent & Design

This is the design source-of-truth for the Media App: why it exists, what a user
can accomplish with it, and the high-level shape of the experience. It is written
to be sufficient to rebuild the app from scratch. Normative capability
requirements live in [`media-app-requirements.md`](./media-app-requirements.md);
wire-level contracts live in [`media-app-technical.md`](./media-app-technical.md).

---

## Item actions and minimum Undo

Item action owners share `executeItemAction`: leaf Play Now preserves the tail;
collection Play replaces in natural order with shuffle off; Shuffle replaces in
shuffled order with shuffle on; Play Next appends to the FIFO next band; Play First
inserts at its front; Add appends. Play on / Add on choose one-shot destinations
without changing the persistent aim. Content components expose additive action
callbacks and do not import Media implementation code.
Escape dismisses an open More menu first. After a menu action closes it,
Escape follows the outer search dismissal lifecycle instead of reopening More.
The dismiss stack preserves layer ownership for the entire key event: a layer
that closes before document bubbling cannot send that same Escape to view Back.

Each operation has a tap identity and a ten-second Undo deadline. The selected
playback owner captures the prior native position and queue generations before
mutation, guards restoration by its applied revision, and rejects late delivery
after cancellation. Queue-only Undo preserves current native playback; playback
replacement Undo restores the prior position (live streams return to live edge).
Undo appears on the action's own outcome row in the outcome tray (below), a
separate row above the mini player, so the mini-player controls stay clickable
throughout the immediate ten-second Undo window.
Remote content operations retain WakeAndLoad readiness and progress handling;
cold-wake cancellation is coordinated before receiver claim. A claim/ACK alone
does not confirm playback: progress still requires authoritative owner state.

The ordinary-input queue journey covers the minimum Undo path; exact-build runtime
verification remains required before claiming acceptance.

## One voice for outcomes

Every play, add, send, queue edit and playback problem reports through one
outcome system (`DispatchProvider` + `DispatchProgressTray`), the same way
whichever control started it. Each record is one attempt at one screen, keyed
`{attemptId, targetId}`, holding the frozen command it was made with.

- **This device:** a quiet, brief row naming the item and "here" ("Playing
  Arrival here", "Added Nova here · 2nd in queue"), with Undo while its
  ten-second window is open. No separate toast.
- **Another screen:** the row names the screen and shows its steps in words that
  fit the kind of screen ("Turning on TV…", "Waking the speaker…", "Getting
  ready…", "Loading…"). It stays visible in every area of the app until the
  outcome is known. Confirmed playback reads "▶ Playing on <screen>" with Steer
  it. A start that cannot be confirmed reads "It may not have started on
  <screen>" with Steer it and Try again, and stays until dismissed; a newer one
  for the same screen replaces it, and it clears itself when that screen reports
  the same item playing.
- **Still starting after the Undo window:** a far start that is still waking or
  loading offers Stop (that screen's Stop, which keeps its queue), so a mis-sent
  cold wake can be aborted from the sending device.
- **Problems** never clear on their own. A press that never reached the screen
  reads "Not sent to <screen>" and is never replayed later: Media asks the
  backend for no deferred retry, and a screen with no connected receiver is not
  called "sent". Every failure has its own Retry, which replays exactly that
  attempt (same item, same screen), and "Another screen…" to send that attempt
  elsewhere. Several failures stay separate.
- **Local playback failures:** when an item on this device stops making progress
  or the Player gives up on it, it is skipped and a notice names the item, this
  device and what plays instead. The mini player shows a problem sign until
  playback is moving again. A file the server refuses to read is waited out
  first: after 3 s a notice reads "Waiting for <title> — the file is being
  repaired" (Skip now, Retry); it resumes if the file comes back, or after 60 s
  is skipped as "file unavailable". If the next item also waits within 60 s,
  Media holds on it with one "Library unavailable" notice instead of skipping
  through the queue.
- **Never in the way:** notices float over the page just above the mini player
  (or tab bar). They take no page space, move nothing when they appear, and
  only their own buttons take taps, so the handle's controls stay reachable.
- Screen readers hear the newest outcome through one polite live region.

## Keeping your place

A reload or crash restores what was playing, its spot, its queue, repeat and
shuffle, the aim (unless its two-hour idle time has passed) and the area of the
app — **paused**. Nothing loads or sounds until Play: the Player is not mounted
for a restored session until the person presses Play, and then it starts at the
restored spot. Saved data from an older version or in a broken shape is
discarded and the app starts clean. A network loss that lasts more than three
seconds shows a quiet "Reconnecting…" note; the app never reloads itself.

**Start fresh** (Settings, from any area) lists exactly what it will clear on this
device — what's playing, the queue, the spot, the aim — each ticked and each
keepable, and changes nothing until confirmed. The spot can be kept only with
what's playing. Clearing everything starts a new session. Other screens are
never touched.

## Steering: the handle and the one controls surface

This device's Now Playing and every screen's Remote show the **same controls
in the same layout**; a control a screen can't offer is shown unavailable
with a short reason, never hidden. Every control is a 44 px button that
wraps at phone width, so nothing is lost to a narrow screen.

- **Sleep timer.** Stop in 15/30/45/60/90 minutes, or at the end of this
  item. The time left shows on the controls and on the handle (the mini
  player). A minutes timer fades out over its last 10 s. Afterwards the
  controls offer **Continue where it stopped** (this device pauses, so it is
  plain Play; after an at-end sleep the item is finished, so it reads **Play
  it again**) and **Continue from m:ss, where the timer was set**. The offer
  goes as soon as anything new starts here. An armed minutes timer survives
  closing the page: it keeps its deadline, or, if it came due meanwhile,
  leaves the Continue offer. On a screen the timer stops it with its queue
  kept; its Remote offers the "where the timer was set" choice. The fade
  uses the element volume, so on iOS Safari (read-only media volume) the
  timer just pauses.
- **Next episode.** At the natural end of an episode whose next queue item is
  also an episode, a 10-second countdown names the next one, with **Play
  now** and **Cancel** (Cancel stays on the finished episode, queue kept).
  **Stop after this one** stops at the end of the current item, once.
- **When the queue ends** (bottom of the queue, with the current choice):
  **Stop**, **Repeat the queue**, or **Keep similar playing** — the next few
  items from the finished item's show/season (episodes) or artist/album
  (music), never-played first, then not played this week; never the whole
  library. Items it adds are marked "added automatically"; it stops by itself
  after about two unattended hours, and says "Nothing similar left" when it
  runs out. These modes belong to the session: a new start resets them.
- **Add only** (a screen's Remote): one step on or off. On this device it is
  shown unavailable, with the reason (it belongs to a screen other devices
  play to). While on, Play from
  any other device is added to that screen's queue instead of replacing it,
  and the sender reads "Added <item> to <screen> (Add only is on) · Nth in
  line". Automations still play. Anyone can turn it off.
- **Notes and Put it back.** When a device pauses, stops, replaces or moves a
  screen's playback, that screen shows "Paused by <device>" (repeats grouped,
  volume never noted), and every device's Remote for that screen lists the
  same notes — so a speaker that can't show a note is still covered. For
  10 s, **Put it back** restores the item, its spot and its queue, from the
  screen or from any Remote.
- **Add to this queue** (a screen's Remote) opens the one search pointed at
  that screen for a single addition; the aim does not change.
- **Move to…** (a screen's Remote) lists every other screen and **This
  device**. The destination picks up at the same moment; only once it has
  started is the original stopped (it shows "Moved by …"). If the
  destination can't confirm, the original keeps playing and the outcome says
  so. Moving to this device opens Now Playing.
- **Several screens.** The screen picker's **Choose several screens** aims at
  more than one; the aim then reads "Kitchen + Living Room". Screens chosen
  in the same room warn that they can drift apart audibly. Each screen gets
  its own progress and outcome, Add to queue adds to each, and they are
  steered separately; when two play the same item, either Remote (and Now
  Playing) offers **Line up with <other>**, which seeks it to the other's
  spot.
- **Lock screen.** Playback on this device shows its title, show and artwork
  in the system media controls (lock screen, notification), with play/pause,
  next/previous and seek — the same commands as the app's own buttons.
## Subtitles, Show briefly, and music behind a slideshow

These live in the one set of playback controls, so they work the same for
playback on this device and for any screen through its Remote
(contracts: technical doc §4.11 and §6.7).

**Subtitles and audio language (STEER.12a).** Under the transport, a
**Subtitles** button opens a menu of exactly the subtitles the item has, each
by its own name ("English [SDH]", "European Spanish"), plus **Off**; an
**Audio** button appears only when the item has more than one audio track.
The list fits the screen and scrolls. Choosing one restarts the stream at the
same spot with the subtitle drawn into the picture (Plex), or switches the
track in place (streams that carry their own tracks). The choice is
remembered for the show, on that device or screen: the next episode starts
with it (its own matching stream), and **Off** is remembered too. Players
nobody steers from here — the garage display, the piano tablet, a school
lesson — are untouched.

**Show briefly (PLAY.8a, PLAY.8b).** An item's detail page has **Show
briefly on…**: pick a screen and the item plays OVER what is on it. The
programme pauses underneath; a bar on the screen says what is showing and
where it came from ("Keepy Uppy · from Dad's phone") and when the programme
comes back. Close it on the screen (Close or Back), from the screen's Remote
(the controls show "Showing …" with **Close**), or let it finish: the
programme returns at its spot, with its queue, playing if it was playing.
Routines use the same thing: a routine that starts a camera on a screen
(`play=camera:<id>`) shows it briefly by default — 30 seconds, then back —
unless the routine says `brief=0`, which makes the camera take the screen.
Anything else that starts on the screen meanwhile wins, and nothing comes
back.

**Music behind a slideshow (PLAY.9a).** While a photo slideshow plays,
**Add music behind** opens a music search; choose a song, album or playlist
and it plays under the photos. The music has its own row ("Music behind ·
Faith" with play/pause, next and stop), so skipping a photo never skips a
song and pausing the song never stops the photos. On a screen a small plaque
shows the song. Pressing **Stop** on the slideshow asks **Keep the music
playing?** — **Keep music** stops only the photos; **Stop music too** stops
both; **Cancel** stops nothing. The music never plays under something with its
own sound: when a video or any non-photo item replaces the photos it stops
(even after **Keep music**), and when the slideshow stops without Keep it stops
too. This holds on this device and on a screen. The mini player's Stop asks the
same question; moving the slideshow to another screen, **Stop all** and **Stop
and turn off** do not ask, and stop the music.

## Browser identity and house presence

Each browser is a first-class named screen with one persisted identity:
`{ clientId, deviceId: "browser:<clientId>", name, room?, connectedAt }`.
Reloading preserves that identity and its `client-control:<clientId>` route;
renaming changes only its human label and optional room. The Settings menu owns
that rename surface and resolves a name collision with a stable identity suffix.

The local session has one authoritative house-state path: it publishes canonical
`playback_state` envelopes, the EventBus validates the registered owner and relays
them, and Fleet consumes that relay. Fleet does not synthesize a competing local
row. Canonical rows retain owner, revision, origin, queue and last-heard data.
Closing a browser emits a stopped/disconnected state; silence is shown as
uncertain after two minutes, with last-heard and unconfirmed-control copy.

Another browser is controlled through its stable registered route. Fleet Pause
and Stop use that route and await the receiver ACK without issuing a hardware
Device API write. Routine commands carry their origin, and the same routine
trigger/target is deduplicated for ten seconds while a later human-origin command
always runs.

**Names come from the household screen registry** (RQ-HOUSE-06; contract in
the technical doc §2.5). On start a browser announces itself
(`POST /api/v1/media/screens/announce` with `browser:<clientId>`) and takes the
name and room the registry holds for it, so a name chosen on one device is the
name every device shows. The same `browser:<clientId>` is the
`X-Daylight-Device` id on every request the app makes, so when this browser
starts something on a screen, that screen's "Started by" names this browser.
Rename (Settings → **Rename this device**, or **Screens** for any screen) goes
through the registry: a taken name comes back with a free suggestion
("Kitchen tablet (2)") to accept in one tap; renaming a screen a routine uses
lists those routines first and needs **Rename anyway** — routines follow the
screen, not its name. A renamed screen shows "(was <old name>)" for a week,
except when the old name was the made-up "Browser 1a2b3c4d" nobody knew it by.
With the registry out of reach a rename stays local and unique among the names
this device can see. A browser's live name (its heartbeat) wins over an older
copy of the screen list, and a difference re-reads the list.

**First use** (RQ-RELY-12): on a device that has never been named, Home starts
with a card asking for a name — a default for the kind of device ("iPhone",
"Android tablet", "Mac"), **Save name** or **Skip** — and explaining the aim
label once, with the live label shown. Either answer is remembered
(`media-app.first-use-done`) and the card never returns on that device. It is
page content at the top of Home, not an overlay, so nothing beneath it is
blocked.

## The house view

The Devices view is the house at a glance; each row adds, beyond state, item
and progress:

- **Start progress or last failure, to everyone** (RQ-HOUSE-04): "Starting:
  Turning on TV…", "Started", "Added to its queue", or
  "Couldn't start at 7:02: <reason>" — whichever device sent it. The row reads
  `GET /device/:id/start-status` when the view opens (a failure from before
  still shows) and follows `device-start:*` live. A failure stays until a later
  start on that screen succeeds.
- **Started by** (RQ-HOUSE-07): "Started by Kitchen Button 1, 7:02" or
  "Started by Dad's phone, 7:02" while it plays; nothing when the start's
  origin is unknown. `StartedByLine` (`house/RowExtras.jsx`) is the same line
  for a screen's controls header.
- **Add only** (RQ-PLAY-10): "Add only is on: Play from other devices adds to
  the queue." with **Turn off** — anyone can switch it off from the row.
- **Notes** (RQ-STEER-21): a screen that can't show notes itself (a speaker)
  lists its notes on its row — "Paused by Dad's phone ×2 · 7:02" — with **Put
  it back** while that is still possible.
- **Stop** (RQ-STEER-11): where the screen has device control (and is not a
  speaker or a browser), a menu beside Stop offers **Stop and turn the screen
  off** (queue kept, then `/device/:id/off`).
- **(was <old name>)** after a rename.

Above the rows, **Pause all** / **Stop all** (RQ-STEER-13) act on every screen
playing (or active) — this device included — through each screen's own
session transport. After Pause all, **Resume all (N)** plays exactly the
screens it paused. The same three sit in the handle's house menu (the house
icon on the mini player). The outcome names how many screens were reached and
lists every screen that wasn't ("Not paused: Office (not reachable)"); an
offline screen is not sent anything, and one that doesn't answer within 8 s
counts as not reached. **Screens** and **Routines** lead to the two views
below.

**Screens** (RQ-HOUSE-08): every screen under its name, room, kind and when it
was last seen. **Add a screen** (name, room); **Name and room** for any screen;
**Merge into…** folds a duplicate browser or added screen into its earlier self
after a confirmation that names the routines on both (Undo on the outcome for
10 s, **Unmerge** on the screen afterwards); **Retire** first lists the
routines that point at the screen; retired screens can be **Restored**.
Screens silent for 30 days fold into **Not seen lately**. A configured TV or
kiosk cannot be merged away.

**Routines** (RQ-AUTO-05): recent routine starts, newest first — when, which
routine, which screen, what, and the outcome ("Played", "Started, not seen
playing", "Failed: Living Room TV did not turn on", "Repeat ignored") — and,
above them, **Before they run**: routines pointed at a screen that is off,
unreachable, retired or unknown, or whose last start failed.

## The start page and the household's memory

The start page (Home) is built from the household's shared media memory
(technical §2.4–2.9), one list for the whole house with each item labelled with
where it played. From the top:

- **Resume** — this device's own session, when it has one.
- **Playing now** — anything playing on another screen right now, as "Now on
  <screen>" with **Remote** (opens that screen's remote) and **Move here** when
  this device can steer that screen (otherwise just "Now on <screen>" and the ⋯
  verbs). Such an item is never offered as Carry on. Move here adopts that screen's session
  on this device and stops the screen only after this device is actually
  playing the item, and only if the screen is still on the same playback; if
  either is not true the other screen keeps playing and the notice says so.
- **Suggestions for this screen**, in the server's order (`GET
  /media/suggestions?deviceId=<this device>`): **Favourites** first as large
  pictures (the picture opens it; its **Play** / **Continue <part>** plays it),
  **Carry on** (how much is left and on which screen; a series' next episode;
  when screens hold different spots, both — "12 m on Kid's tablet · 1 h 20 m on
  Living Room TV"), **Usually (here) at this time**, and **New**. Nothing playing
  on any screen is ever suggested. With nothing to suggest the page says so and
  leads into Browse.
- **Recent** — everything played on any screen, newest first, marked with where
  it played and when.

Every item, wherever it appears (start page, Played earlier, search, browse,
details), has the same verbs: Play now, Play next, Play first, Add to queue,
Play on…, Add on…, Details, Add to / Remove from favourites, Mark watched /
unwatched (playable items), and — in Recent, Carry on and suggestions — **Remove
from household list**. A removal disappears from every list on every screen and
is undone from its notice for 10 seconds. Favourites are shared by the household;
anyone can remove one. Each of these changes reports through the one outcome
system, never a separate toast.

**Saved spots.** Each screen keeps its own place. Playing an item with one saved
spot continues from exactly that spot and the confirmation offers **Start over** (for 15
seconds; it restarts the item from the beginning on that screen); when screens
hold different spots the person chooses ("1 h 20 m on Living Room TV", "12 m on
Kid's tablet", or From the beginning); with no spot it simply starts. A chosen
spot plays from exactly there on this device and on Media screens; a spot saved
before screens kept their own reads "saved earlier". Screens that load by URL
ignore a start position, so a play there makes no "Continuing from" claim. Details show how
far each screen has got when the household lists know the item.

**Played earlier.** Every screen's queue panel — this device's and any remote
one's — ends with what played there earlier, newest first, with picture, title
and time, shuffled and "keep similar things playing" runs included, each with
the full verb set.

Local playback reports its progress with this device's identity (every request
carries `X-Daylight-Device`); when a routine or another device started the item,
that origin rides the progress report too, so "started by" and the ledger know.

## What This App Is

The Media App is the household's **universal content front door and universal
remote**. It is one surface — opened in any browser at `/media` — where a person
can:

- find **anything** the system knows how to play (movies, shows, music, hymns,
  audiobooks, photos, livestream channels, camera feeds, apps),
- play it **right here** in this browser,
- or send it **anywhere** in the house,
- while seeing — and controlling — **everything** that is currently playing on
  every screen and speaker the household owns.

The app adds no content knowledge of its own. It is a thin dispatcher over the
content paradigm (`docs/reference/content/`): anything resolvable by the Play
API is in scope, and a new content format landing in the platform appears in
this app with zero app changes.

## Objectives

1. **One front door.** A user never needs to know which backend system holds a
   piece of content. Search and browse span the entire catalog.
2. **The browser is a first-class playback surface.** Local playback is not a
   preview mode — it is a full session with a queue, transport, volume,
   shuffle/repeat, and persistence.
3. **Every screen in the house is one tap away.** Dispatching content to a TV
   or kiosk is as easy as playing it locally, including waking the device.
4. **Total session awareness.** The fleet view answers "what is playing in my
   house right now?" at a glance, live.
5. **Control without disruption.** A user can pause, seek, or re-queue any
   device's session from this app without touching what they themselves are
   playing (peek), and without walking to the device.
6. **Sessions are portable.** What's playing on the TV can be pulled to a
   laptop (take over); what's playing on a laptop can be pushed to the TV
   (hand off) — position, queue, and settings travel with it.
7. **Nothing is lost, nothing blocks.** Reloads and crashes resume where the
   user left off. A dead device, a failed dispatch, or an unreachable backend
   never takes the rest of the app down with it.

## Non-Goals

- **Running on the TVs themselves.** Kiosks and TVs run a separate
  screen-framework player app. This app dispatches to them and observes them;
  it is never installed on them.
- **Accounts, profiles, personalization.** No login, no watchlists, no
  recommendation engine. (A per-browser display name exists purely so external
  observers can label this client.)
- **Catalog management.** Read-only against the content APIs.
- **Livestream channel administration.** Programming a channel (DJ board,
  per-channel queue admin at `/media/channels/*`) is a separate app. This app
  consumes channels as tunable content only.
- **Surveillance UI.** Camera feeds are tunable content; PTZ, detection
  overlays, and other camera-specific controls belong elsewhere.

---

## User Stories

### Discover
- As a household member, I want to type a few characters and see live results
  from every source at once, so I can find content without knowing where it
  lives.
- I want to narrow a search to a scope ("Movies", "Music", "Books") from the
  search box itself. Every new search starts catalog-wide; scope is
  deliberately never carried over between searches or reloads.
- I want a home screen with my in-progress item and recent plays, so the
  common case is zero typing.
- I want to drill into any category, folder, or collection and page through
  it, with containers and playable items distinguished.
- I want a detail page for any item showing artwork, description, and every
  action I can take on it.

### Play locally
- I want to play anything in this browser immediately, and keep browsing,
  searching, and queueing while it plays.
- I want playback to continue uninterrupted no matter which view I navigate
  to — a persistent mini player tells me what's playing and lets me
  pause/stop from anywhere.
- I want a full Now Playing view with seek, transport, volume, the queue,
  and a hand-off control.

### Queue
- Against any search result, browse row, or detail page, I want the four
  queue actions — **Play Now**, **Play Next**, **Play First**, **Add to
  Queue** — without leaving where I am, with instant visual confirmation.
- I want to see the queue, jump to any item, remove items, clear it, and
  toggle shuffle and repeat (off/one/all) — whether or not anything is
  playing.

### Cast
- I want to send any item to one or more devices in a single action, choosing
  per dispatch whether my local playback **transfers** (stops here) or
  **forks** (keeps playing here too).
- I want to watch the dispatch progress live (wake → prepare → load), and
  retry a failed dispatch without re-entering anything.
- I want to set a preferred cast target once so subsequent casts are one tap.

### Observe and control the fleet
- I want one view listing every configured device with its live state:
  online/offline, what's playing, position, and queue — marked stale when the
  connection drops rather than silently lying.
- I want to open a remote-control panel for any device (peek) and drive its
  transport, seek, volume, and queue — and have controls respond instantly
  even though the device confirms asynchronously.
- I want to pull a device's session to this browser (take over) and have the
  device stop while I continue from the same position with the same queue.
- I want to push my local session to a device (hand off) with everything
  intact.

### Trust it
- When I refresh or my browser crashes, I want my session — item, position,
  queue, settings — exactly where I left it, with an explicit, confirmable
  way to reset to a clean slate when I want one.
- When something fails to play, I want the app to move on to the next queue
  item and tell me, not freeze.
- As a home-automation author, I want to open the app with `?play=…`/
  `?queue=…` deep links and to observe/control the browser session over
  WebSocket, so the app composes with the rest of the house.

---

## Primary User Journeys

All journeys are concurrent and non-exclusive — the app never forces a mode
switch. (These J-numbers are referenced by the requirements doc.)

### J1. Discover and play locally
Search or browse → pick an item → it plays in this browser. Browsing,
searching, and queueing remain available before, during, and after playback.

### J2. Build and manage the queue
From any item: Play Now / Play Next / Play First / Add to Queue. Against
the queue: remove, jump, clear, shuffle, repeat (off/one/all). Available at
all times, for the local session and for any peeked remote session alike.

### J3. Dispatch to a remote device
Find content → pick target device(s) → choose Transfer or Fork → dispatch.
The device wakes if needed; progress streams live; failures are retryable.

### J4. Observe the fleet
One view, every device, live: state, current item, progress, queue. Offline
devices stay visible with their last-known snapshot.

### J5. Peek and control a remote session
Open a device's remote-control panel and drive its transport and queue
without altering the local session in any way.

### J6. Take over a remote session
Pull a device's session to this browser: the device stops, the local session
adopts its item, position, queue, and config, and resumes seamlessly.

### J7. Hand off local to a remote
Push the local session to a device, Transfer or Fork. The device adopts the
full session state and resumes within seconds of where local was.

### J8. Resume after disruption
Refresh, crash, or network blip → the session restores from persisted state.
An explicit reset action (with confirmation) returns to a clean slate.
A session that was persisted as **ended** (the queue played out, or an end was
held) replays from the start of that item when you press Play after a restore.

### J9. External trigger
An external system opens `/media?play=<contentId>` (plus optional shuffle/
shader/volume) and the content autoplays locally — exactly once, idempotent
across refreshes. Remote dispatch from external systems goes through the
Device API, never through this app's URL.

---

## High-Level Design

### One shell, three regions

The app is a single-page shell with a persistent **dock**, a primary **nav**,
and a **canvas** that shows exactly one view at a time:

```
┌────────────────────────────────────────────────────────────┐
│ DOCK   [ scope chips ][ search…     ]  fleet●  cast▸   ⚙   │
├──────┬─────────────────────────────────────────────────────┤
│ NAV  │  CANVAS                                             │
│ Home │    one of: Home · Browse · Detail · Now Playing ·   │
│Browse│            Fleet · Peek                             │
│ Devs │                                                     │
├──────┴─────────────────────────────────────────────────────┤
│ dispatch progress tray (while casting)                     │
│ ♪ mini player (while playing, paused, or queue is retained)│
└────────────────────────────────────────────────────────────┘
```

**The dock is the app's constant.** It carries:

- the **search bar** with scope selector — search is always one keystroke
  away, never a destination page; results drop down inline. A row tap plays
  a playable item at the current destination and opens a container in
  Browse; containers carry a trailing ▶ (play the whole thing) and playable
  items a trailing ⋯ (Play Now / Play Next / Play First / Add to Queue / Open
  detail). Per-item Cast lives on the Detail view, not on result rows,
- the **fleet indicator** — an at-a-glance summary of what's playing in the
  house, linking to the fleet view,
- the **cast target chip** — the currently-preferred dispatch target. It
  governs the search bar too: with a target configured, picking a search
  result casts there in the chip's mode rather than playing locally. The
  destination sheet always includes **This device**, which clears remote
  targets immediately. Opening or leaving Peek never overrides or changes
  that destination; a one-off picker still affects only its explicit action,
  and a remote aim has a two-hour inactivity lease. Verified matching playback
  that this browser sent or is steering suspends that lease; stale or unknown
  receiver state does not. Restoration resolves expiry before first layout so
  an expired screen never flashes as the active destination,
- the **settings menu** — device name/room editing and session reset (confirmed).

Below the canvas, at every width, the shell stacks:

- the **dispatch progress tray** — live step-by-step progress of in-flight
  casts, with each failure row retrying only its original target, content,
  options, and hand-off snapshot,
- the **mini player** — current local item, live progress strip, queue
  position counter, play/pause/next/stop (a small live picture for video);
  tapping the title opens Now Playing. Stop retains a ready handle while the
  queue has items so the queue can be opened or restarted; clear/reset removes
  the handle once both the current item and queue are empty.

Local Now Playing and a remote Peek use the same ordered controller frame:
seek, transport, then queue. Capability differences do not remove controls;
the control stays visible and states the receiver-provided reason it is
unavailable. Stop retains the queue and Clear remains a separate action.

A destructive Move is a two-owner transaction. Its request binds an
`operationId`, destination, captured snapshot, and the source owner/revision.
HTTP or command receipt is never adoption proof. The destination must return a
typed started receipt bound to that operation, queue/current-item identity,
destination revision, and an admitted native renderer that is ready and
advancing for a playing source, or ready and still paused at the captured
position for a paused source. Paused adoption is issued without autoplay.
Rejection, timeout/uncertainty, or any newer source revision keeps
the source playing. Only confirmed adoption may conditionally stop the exact
unchanged source; **Keep playing here too** never stops it.

Aim labels always read the one persisted global aim, including while a person
is steering a different screen in Peek. A busy origin is shown only when a
fresh receiver snapshot carries explicit `meta.origin` provenance: either a
known `{ kind: 'device', id }` belonging to a different client/device, or a
named `{ kind: 'routine', name }`. The current browser client and configured
fleet-device identities are compared by their canonical IDs, never by display
name; canonical `fleet:<id>` provenance and the roster's bare `<id>` identify
the same configured device. Receiver ownership metadata is not sender
provenance and is never presented as such.

**On phones the dock cannot hold all of that at once — so it doesn't try.**
At 360px there is ~336px to spend; splitting that between a scope selector, a
search input, and a 168px icon cluster left the input ~50px wide (its own
placeholder didn't fit), and a `.media-dock:has(.media-search-bar:focus-within)`
rule used to hide the scope selector and the icon cluster the instant the
field got focus — the one moment scope mattered. That rule is gone. Under
`mobile-only` the dock is now a **launcher**: a full-width "Search media…"
button plus the settings gear (`Dock.jsx`). Tapping the launcher mounts
**Search Mode** (`search/SearchMode.jsx`) — a full-screen overlay, not a
route, rendered by the shell alongside the current canvas view (which stays
mounted underneath, untouched) — giving search the whole screen instead of a
shared row:

```
┌────────────────────────────────────────┐
│ ✕  [ search…                        ]   │
│ ▶ Playing to: This device               │
│ [All] [Video] [Music] [Books]           │
│ results…                                │
└────────────────────────────────────────┘
```

Search Mode resets scope to catalog-wide ("All") on every open, autofocuses
the input, and reuses `useContentCombobox` (the same search state/transport
machine `MediaContentSearch` uses) but renders its own plain results list
rather than mounting the Mantine `Combobox` popover, which doesn't fit a
full-screen surface. It mounts `ScopeChips` and `DestinationLine` unchanged —
the same components the desktop dock and Now Playing use — so "where does a
tap go" reads identically everywhere. A row tap dispatches through the same
`useContentDispatch` path as the desktop search bar. Ordinary Play, explicit
container playback and existing queue actions retain the search surface,
query and narrowing; leaf Play deliberately avoids the combobox's selecting
close transition. Container/detail navigation closes search and replaces its
history marker. Browser Back or explicit close consumes the one marker pushed
on open, so repeated playback actions do not add extra Back presses. The
redesign's explicit **Play on…** action still needs its separate integration;
this retention repair does not establish that missing path. The fleet
indicator and cast target chip are desktop/
tablet-only now — on mobile the fleet-active signal moved to a small badge on
the Devices tab (`PrimaryNav.jsx`, sourced from `useFleetSummary`) instead of
occupying dock space that search now owns outright.

Every search surface consumes one lifecycle value:
`SearchState = { query, scope, sources, results, phase, failedSources }`, where
`phase` is exactly `idle | loading | partial | complete | failed`. A new query
generation retires older callbacks, while widening may retain already observed
source failures. Pending, partial, failed and widened states therefore use the
same wording and ordering on the dock, Search Mode and destination picker: a
named source failure and its Retry action appear before any wider result claim,
and a settled empty result cannot still present as loading.

At tablet-up widths the dock is unchanged: the persistent search bar (with
inline scope chips), fleet indicator, and cast target chip all still render
exactly as before. The left search icon remains `pointer-events: none` — it
is decoration, never a tap target.

### Views

| View | Purpose | Reached from |
|---|---|---|
| **Home** | The start page: Resume, Playing now on other screens, this screen's suggestions (Favourites, Carry on, Usually (here) at this time, New) and the household's Recent — see [The start page](#the-start-page-and-the-households-memory). | Default; nav; breadcrumb. |
| **Browse** | Hierarchical catalog listing with artwork or a recognisable placeholder, kind labels, natural part ordering, and a breadcrumb containing every parent. Long collections page automatically as the end approaches; there is no separate load-more hunt. Pages are 50 titles: `GET /api/v1/list/...?take=50&skip=N` returns `{ items, total }`, and for Plex path containers (e.g. `library/sections/6/all`) the page is fetched from Plex itself (`X-Plex-Container-Start/Size`), so a 2,800-title library opens in ~0.3 s instead of sending every title. Each history entry owns `{ path, scrollTop, focusedId, loadedCount }`, captured before drilling into a container or opening Detail through either Details or More → Open detail. Back re-fetches `loadedCount` rows in one request (capped at 1,000) so a row the person had scrolled to exists again, then restores the exact prior collection viewport and triggering row focus. `loadedCount` is a viewport snapshot like `scrollTop`: re-selecting the Browse area ignores it when matching the original root entry. A specific container adds Play / Shuffle / Add at the top and names the current destination. | Nav; container rows; container taps in search. |
| **Detail** | One item: artwork, description, how far each screen has got, full action row (Play Now / Play Next / Play First / Add / Cast), favourite and watched marks. | Browse rows; search results; any item's Details. |
| **Now Playing** | Full local transport: seek bar, prev/play-pause/next/stop, volume, the queue panel, and the hand-off picker. Hosts the visual output of the player. | Mini player; Escape/Back returns. |
| **Fleet** | Configured devices and named browser screens, live and sorted with playing first. Each card offers **Remote**, **Play…**, inline **Pause**/**Stop** while active, and a truthful unavailable **Move here** until safe native adoption exists. Silent browser rows become uncertain after two minutes. Rows also carry start status, Started by, Add only, notes and "(was …)"; the view offers Pause all / Stop all / Resume all (see "The house view"). | Nav; fleet indicator. |
| **Screens** | Screen admin: add, name and room, merge/unmerge, retire after the routines are shown, restore; "Not seen lately". | Devices → Screens; Settings. |
| **Routines** | Routine history and the routines flagged before they run. | Devices → Routines; Settings. |
| **Peek** | Remote control for one device: transport, seek, volume, and the same queue panel bound to the remote session. Optimistic — controls reflect the predicted state instantly and lock until the device confirms. | Fleet cards. |

The queue panel is **one component used twice**: bound to the local session in
Now Playing, bound to a remote session in Peek. Queue semantics are identical
either way — that symmetry is a core design intent, not an implementation
convenience.

### Navigation model and paths

The app owns a single route, `/media`. Views are addressed by **URL query
state**, not by sub-routes, so navigation state and playback deep-link
parameters coexist in one URL:

| URL | Shows |
|---|---|
| `/media` | Home |
| `/media?view=browse&path=<source/segment>` | Browse at a catalog path |
| `/media?view=detail&contentId=<source:id>` | Item detail |
| `/media?view=nowPlaying` | Now Playing |
| `/media?view=fleet` | Fleet |
| `/media?view=peek&deviceId=<id>` | Remote control for a device |
| `/media?play=<contentId>&shuffle=1&shader=<s>&volume=<v>` | Deep-link autoplay (J9) |
| `/media?queue=<contentId>` | Deep-link queue append, no autostart |

Rules of the navigation model:

- In-app navigation is a **stack** (push/pop) mirrored to the URL, so the
  browser Back button, sharing a URL, and refreshing all do the right thing.
- Reselecting a primary area traverses to its existing root entry; one Back
  then reaches the prior area. Saved browse scroll and focus do not change
  that root's route identity, and its viewport snapshot remains available.
- Navigation parameters (`view`, `path`, `contentId`, `deviceId`) and playback
  parameters (`play`, `queue`, `shuffle`, `shader`, `volume`) are disjoint
  namespaces; writing one never clobbers the other.
- Deep-link playback parameters are processed **once** — a dedupe token makes
  refreshes idempotent. Unknown parameters are ignored and logged.
- Remote-dispatch parameters (e.g. `device=`) are deliberately **not** part of
  the URL contract; external remote dispatch uses the Device API.
- `/media/channels/*` belongs to the separate livestream-admin app.

### Playback is ambient, not modal

The defining architectural intent: **playback belongs to the session layer,
not to any view.** The player renders into a hidden mount that lives above
the view layer; navigating between Home, Browse, Fleet, or Peek never
unmounts or interrupts it. The Now Playing view doesn't *own* playback — it
merely re-hosts the player's visual output while open. The mini player is the
always-visible handle on the ambient session.

Consequences this design must preserve in any rebuild:

- Audio continues across all navigation.
- The session (item, position, queue, config) outlives every view.
- Format-specific rendering is delegated entirely to the platform's playable
  format registry; the app never branches on content format.

**How re-hosting must be implemented.** `PlayerBridge` owns exactly one DOM
node, always portals the player into it, and re-parents that node with
`appendChild` as views claim and release the host (`usePlayerHost`). Views
never receive the player as portal *target* directly. Rendering the player
inline when unhosted and portalling when hosted reads as equivalent but is
not: React treats a portal and a plain element at the same position — and two
portals with different `containerInfo` — as a type change, so every host
transition unmounts the media element and kills in-flight playback with
`AbortError: The play() request was interrupted because the media was removed
from the document`. Audio claims no host at all (the mini player's dock claim
is video-only), so an audio track dispatched from search mounted in the
off-screen park and was then remounted by the arriving claim; recovery fell to
the 15s stall watchdog, 19s after the tap. Guarded by
`PlayerBridge.test.jsx`.

`contentId` is the bridge's playback identity. Resolved metadata, duration,
position, and native paused/playing state are reconciled into the current
session and matching queue entry without replacing the active Player item.
Transport commands do not claim a state or position change until Player or
native-media evidence arrives. The bridge follows Player's native media
accessor (including the video element inside the DASH player's shadow root),
so host changes and focused-video presentation retain the same media element.
Native `seeking` updates the transient position display from the element's
observed position, without persisting it or claiming decoder completion.
Native seek completion publishes the element's actual position even while
paused, when another progress tick may not arrive. Seek completion does not
prove that a buffering decoder has resumed playback. Discrete native events
must match the active playback generation, accessor node, and mounted content
identity before updating the session, so a pending source replacement cannot
attribute the previous source's events to the newly selected item.
Mounted identity comes from resolved renderer metadata (`contentId`, or the
`id` field returned by `/play`), never from an unresolved playback request.
Host claims can request Player's existing `focused` shader without moving
playback ownership out of the bridge.

DASH's initial autoplay probe expires as soon as the native element emits
`play` or `playing`. A successful start followed by a user pause therefore
cannot be resumed by the delayed startup check, including a pause while the
first frame is still buffering. A source that has never accepted playback
keeps its startup probe so browser autoplay rejection can still be detected.

Plex DASH fallback streams explicitly disable stream-copy at both decision
and start. Copied source GOPs were observed at timestamps different from the
fixed-duration MPD, leaving a seek permanently without a decoded frame.
Re-encoding restores the advertised segment timeline; eligible original MP4
direct play, audio URLs, and non-DASH copy remain available. This is a global
DASH policy, not a Media-only setting: it adds encoder load and may reduce
quality/frame rate (existing defaults: 8 Mbps, 1080 resolution, 30 fps).
The historical garage 60 fps software-transcode/throttle stall remains a
regression risk; passing two movie seeks does not verify those other clients.

### Concurrency: nothing blocks anything

Every capability runs in parallel with every other: search while playing,
dispatch while browsing, peek one device while local plays and a second
dispatch is in flight. There are no modal "now casting…" states; long-running
operations surface in the dock tray and the user keeps working.

### Remote control feels local

Every remote command takes a network round trip before the device's
broadcast state reflects it. The peek surface therefore renders
**optimistically**: the affected control flips to the predicted state
immediately and locks (visually pending) until the device's real state
arrives or a short timeout expires. Conflicts between concurrent controllers
resolve by last-writer-wins at the device; the device's broadcast state is
always ground truth and the app always converges to it.

Previous and restart-current are separate transport meanings: Previous moves
to the preceding queue entry, while restart-current is an explicitly named
seek to zero. Seeking exposes `seekable`, `live`, and an unavailable `reason`
for both local and remote sessions, so live or duration-unknown playback shows
why a position control is unavailable instead of silently doing nothing.
Queue Add likewise resolves only after authoritative session state reports
the increased queue revision and appended ordinal; a transport HTTP ACK alone
is not an Add outcome. Confirmed Add receipts name the item and screen and show
that ordinal (for example, “2nd in queue”).

### Config-driven surfaces

What scopes search exposes is household configuration, not code: it comes
from the media app config
(the household `media/config.yml`, falling back to the legacy `media/app.yml`
where the scopes live today; served at `/api/v1/media/config` —
`searchScopes` becomes the scope tree; see
[`search-scopes.md`](./search-scopes.md)). Adding a search scope is a config
edit, not a deploy. `browse` entries in that file are no longer read: they fed
the home category cards, which were removed.

### Conceptual subsystems

A rebuild should preserve these seams (each is an independent concern with a
narrow interface):

| Subsystem | Responsibility |
|---|---|
| **Client identity** | Persisted per-browser `{clientId, deviceId, name, room?, connectedAt}`; the stable ID owns logs, canonical broadcasts, rename-safe routines and external control. |
| **Local session** | The playback engine: queue state machine, transport, config, persistence to `localStorage`, stall detection, auto-advance, position heartbeat. |
| **Fleet observation** | Device roster + live per-device session snapshots over WebSocket, with staleness and offline synthesis. |
| **Peek control** | Command issuance to one remote session (transport/queue/config) with ack correlation and optimistic overlay. |
| **Cast / dispatch** | Target selection, fork/transfer choice, multi-target fan-out, wake-progress tracking, retry. |
| **Session portability** | Take over (claim remote snapshot → adopt locally) and hand off (push local snapshot → device adopts). |
| **Search** | Streamed multi-source search with scope filtering and inline-actionable results. |
| **External control** | URL deep-link command processing and inbound WebSocket commands targeting the local session. |
| **Shell & navigation** | Dock, nav, canvas, view stack ↔ URL sync. |

The local session and each peeked remote session present the **same
controller interface** (snapshot + transport + queue + config) to the UI;
panels like the queue and transport are written once against that interface
and bound to either side. This symmetry is what makes J2/J5 "identical
semantics" cheap, and it should survive any rebuild. A stopped session keeps
that same queue reachable through the mini-player's explicitly named queue
handle until clear/reset removes it.

### Platform relationships

- **Content paradigm** (`docs/reference/content/`) — defines content IDs,
  formats, the Playable Contract, and the Play/Queue/Info/Display/List APIs
  this app consumes. This app restates none of it.
- **Playable format registry** — renders every format; the extension point
  for new content types (N5.1: new format = zero app changes).
- **Screen framework** — what the *devices* run. Not a dependency of this
  app; it is the other end of the command/state contracts in the technical
  doc.
- **Device session APIs & WebSocket topics** — transport/queue/config/claim
  endpoints and `device-state` / `device-ack` / `homeline` / `playback_state`
  / `client-control` topics, specified in
  [`media-app-technical.md`](./media-app-technical.md).
- **Logging framework** — all diagnostics are structured events per the log
  taxonomy in the technical doc; no raw console output.

---

## Code & Doc Pointers

- App entry: `frontend/src/Apps/MediaApp.jsx` (route `/media` in
  `frontend/src/main.jsx`)
- Modules: `frontend/src/modules/Media/` — `shell/` (dock, nav, canvas,
  views), `session/` (local session), `fleet/`, `peek/`, `cast/`, `search/`,
  `browse/`, `externalControl/`, `logging/`, `house/` (house view rows,
  house-wide actions, screen admin, routine history; events `house.*`),
  `identity/` (browser identity, registry naming, first use)
- Requirements: [`media-app-requirements.md`](./media-app-requirements.md)
- Contracts: [`media-app-technical.md`](./media-app-technical.md)
- Search scopes: [`search-scopes.md`](./search-scopes.md)
- Content paradigm: `docs/reference/content/`
