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
A Browse row's More menu registers as a managed dismiss layer (`onMenuOpenChange` on
`ResultRow`, `BrowseView`), so Escape closes the menu and does not also go Back.

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
  timer just pauses. During the fade the screen itself offers **Keep
  playing**: OK there cancels the timer and restores the volume.
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
- **Switch screen** (a screen's Remote, top of the controls) lists every other
  screen: one tap moves the Remote to it. The aim is never changed by
  switching, and Back returns to the Remote you left.
- **Shuffle, Repeat and the volume steps** on a screen's Remote take effect on
  that screen: its own state changes and the Remote shows it. They never
  interrupt what is playing. Shuffle plays the queued items after the current
  one (and any placed Up Next) in a random order without changing the listed
  order; turning it off plays them in the listed order again. **Move up/down**
  on a screen's queue reorders it and is undoable like Remove and Clear. A live
  channel has no queue panel (it is one thing, with no position).
- **Move to…** (a screen's Remote) lists every other screen and **This
  device**. The destination picks up at the same moment; only once it has
  started is the original stopped (it shows "Moved by …"). If the
  destination can't confirm, the original keeps playing and the outcome says
  so. Moving to this device opens Now Playing.
- **Several screens.** The screen picker's **Choose several screens** aims at
  more than one; the aim then reads "Kitchen + Living Room". Screens chosen
  in the same room, or in rooms marked as neighbours in screen admin, warn
  that they can drift apart audibly. Each screen gets
  its own progress and outcome, Add to queue adds to each, and they are
  steered separately; when two play the same item, either Remote (and Now
  Playing) offers **Line up with <other>**, which seeks it to the other's
  spot.
- **Lock screen.** Playback on this device shows its title, show and artwork
  in the system media controls (lock screen, notification), with play/pause,
  next/previous and seek — the same commands as the app's own buttons.
- **Live content** (STEER.4a/AC3). Where a position would be, a live item
  shows a **LIVE** badge and **Go to live**: one 44 px button, on this device
  and on any screen's Remote. It moves playback to the live edge (the newest
  moment the stream can show) and keeps it playing. Pausing a live stream
  lets it fall behind; Go to live is the way back. The screen publishes
  `isLive` for its item, so a Remote shows the same thing.
- **The handle for another screen** (STEER.1a/AC4). Besides this device's own
  handle, a second slim bar names the screen you most recently sent to or
  steered ("Living Room TV · Playing", the title) with one Pause/Resume
  button, in every part of the app — so pausing the TV when the phone rings
  is one tap. Tapping the title opens that screen's full controls, and the
  bar steps aside while they are open. It exists only while that screen is
  playing or paused; it is never a notice and never covers content.
- **Search keeps its words after a one-shot Play on… / Add on…** (FIND.1a/AC5).
  The tablet and laptop dock search stays open with the typed words, the
  narrowing and the results while the screen picker is open and after it
  closes, as the phone's search does.
- **Play on… while something plays here** (PLACE.6a/AC2). A one-off **Play on…**
  of an item asks, at that moment, **Move: stop playing here** or **Keep
  playing here too**, pre-set to the choice made last time (shown before you
  confirm; the tap on a screen then waits for the confirm instead of sending
  at once). Keep leaves this device playing. Move stops this device only
  after the screen has **confirmed it is playing** — a screen that fails or
  never confirms leaves this device playing.
- **Move here from the house** (HOUSE.2a/AC4, PLACE.7a/AC1). Every playing
  row in Devices carries **Move here** next to Pause and Stop (not on this
  device's own row; disabled with the reason when the screen carries no
  playback-owner identity). It is the same failure-safe move as Home's
  "Now on <screen>": this device starts the same item at the same moment with
  the same queue, and only then is the screen stopped; if it cannot start
  here, the outcome says why and the screen keeps playing. The confirmation
  says where it came from: "Moved <item> here from <screen>" (PLACE.7a/AC3).
- **Whole collections say how many** (PLAY.2a/AC3, PLAY.7a/AC2). Playing,
  shuffling or adding an album, show or playlist confirms with the number of
  items that went there ("Added <collection> (6 items) to <screen>"); a single
  item reads as before.
- **Undo has its own confirmation** (RELY.1a/AC1). Putting a removed item back reads "Put back <item> here", putting a cleared queue back reads
  "Put the queue back here"; undoing an add or a start
  reads "Took back <item> …". The window for the Undo itself is unchanged.
- **Failures a screen raises itself** (RELY.5a/AC4). When a screen you sent
  to or steer gives up on an item and skips (or stops), the outcome tray on
  your device says so — the item, the screen and what plays instead — with
  Retry, wherever you are in the app.
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

**First use** (RQ-RELY-12): on a device that has never been named, a small
popover opens once, anchored to the header's destination control: "What should
we call this device?", the name field prefilled with a default for the kind of
device ("iPhone", "Android tablet", "Mac"), **Save** or **Not now**, and one
sentence explaining where taps go ("Things you play go to the device shown
here. Tap it to change."). Either answer is remembered
(`media-app.first-use-done`) and the popover never returns on that device;
Escape counts as Not now. It is an overlay, never page content — Home no longer
carries a card.

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
  origin is unknown. The same line shows in the header of that screen's
  controls (its Remote), under the screen's name and what it is doing, while
  something plays.
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
**Rooms next to each other** (with two or more rooms): **Neighbours** per room
ties it to the rooms beside it (mutual); screens chosen together in neighbouring
rooms get the same drift warning as screens in one room.
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

## Finding and starting things

- **Collections carry an inline play** (FIND.8b/AC2). A collection result (show,
  season, album, playlist) shows **Play**, or **Continue S2E7** when the
  household has that show under way (an unfinished episode, or the episode
  after the last finished one). Continue plays that episode at the aim; Play
  plays the whole collection as a queue. A collection tap still opens it.
- **Cameras and single photos** (FIND.8b/AC3) are the exception to "a tap plays
  at the aim": a tap shows them on this device, and the second action reads
  **Show on…** (instead of Play on…) to send them to another screen.
- **Starting on…** (PLAY.1a/AC5). While an item's start on a screen is in
  flight (sent, not yet confirmed playing), the item itself reads **Starting
  on Living Room TV…** — in the result row, the start-page tile and the
  detail page — and a second tap does not send it again.
- **Play next, held** (PLAY.5a/AC3). Pressing and holding **Play next** (about
  half a second; a held Enter or Space works too) offers **At the very
  front**, which queues the item ahead of the other "next" items. Releasing a
  hold does not also run Play next. Play first remains in the menus.
- **An id for a source that does not exist** (`plex-main:12345`) settles within
  a second to "No results": the search names the unknown source instead of
  asking every library for the literal text.

## Visual system

The app's look is one small system, defined in the Media pack
(`frontend/src/modules/Media/theme/mediaTheme.js`, `MEDIA_TOKENS`) and surfaced
as `--media-*` custom properties on `<html>` (`frontend/src/Apps/MediaApp.scss`)
so portaled popovers and menus read the same values. It is a daily-use control
surface: the art is the interface, the chrome stays out of its way.

**Colour tokens.** `ink` `#14161B` (body), `surface` `#1D2027` (raised: menus,
popovers, the handle bar), `line` `#2B2F38` (hairlines and borders), `text`
`#ECEEF2`, `muted` `#9AA1AE`, `accent` amber `#E5A00D`. Amber appears **only** on
the primary Play/Resume control, the destination control's device name, the
selected scope segment's underline, the rail's 3 px selected marker, and focus
rings. Never on per-tile bars, filled pills or progress.

**Type.** One family, Atkinson Hyperlegible Next (SIL OFL), self-hosted from
`frontend/public/fonts/atkinson-hyperlegible-next/` (latin + latin-ext variable
files, licence beside them; declared in `theme/_fonts.scss`). Scale: row heading
1.25 rem / 600, tile title 0.9375 rem / 600 / line-height 1.3, meta 0.8125 rem /
400 muted, header controls 0.9375 rem / 500, body 1 rem. Sentence case
everywhere: no all-caps labels, no letter-spaced eyebrows, no arrow glyphs
(back links use a chevron icon).

**One left edge.** The content area is the full width minus the rail (72 px)
with a fixed gutter — 24 px on a laptop/tablet, 16 px on a phone. The header's
destination control, every heading, every row and every block start at that
edge. Rows run the full content width, scroll sideways with scroll-snap and **no
visible scrollbar**; with a pointer, ‹ › step buttons (44 px, keyboard
operable, hidden when the row fits) sit at the heading's right end.

**Tiles** (`browse/HomeTile.jsx`, rules in `browse/tilePresentation.js`):

- *Art first, aspect by kind*: video / episode / clip stills 16:9; film, show,
  book and audiobook posters 2:3; album / playlist / track 1:1; unknown types
  fall back to 16:9. An "album" whose art loads clearly portrait (an audiobook
  cover) switches to the poster shape so its title is not cropped.
- *Title* wraps to two lines (never a single-line ellipsis); *one* muted meta
  line carries the most useful fact — "2 h 39 min left · Garage", "Next
  episode", "Recently added", "4 editions". When screens stopped in different places, a Carry on tile shows one short
  line per spot (at most two) instead.
- Tapping the art or the title is the item's primary action under the one tap
  rule; there is no per-tile Play bar (a next part is "Continue …" in the ⋯
  menu).
- ⋯ is a 44 px target on the art's corner: visible on hover/focus with a
  pointer, always visible but muted on touch (`@media (hover: none)`).
- *Progress*: a 3 px bar along the art's bottom edge in the text colour at 70 %
  for unfinished items.

Browse keeps its list rows (focus restoration and per-row verbs depend on them);
they take the same tokens and type.

**Data presentation** (display layer only): a date-named item ("20261005",
"2026-10-05") reads "<show or source> · Oct 5", never the bare date;
editions of one thing in a row (same normalized title and type) collapse to one
tile whose meta says "4 editions" and whose ⋯ menu opens each; every device
label goes through `displayDeviceName()` (`fleet/deviceDisplay.js`) — a made-up
"Browser 4778f429" or raw browser id reads "a browser" (or "this device" for
the viewer's own browser).

**When something fails to load** (Home rows, Browse, an item's detail, search):
one quiet muted line in the place the content would have been ("Couldn't load
suggestions.", "Couldn't load search results.") and a normal-size secondary
**Try again** button (44 px, not full width, never amber). The user never sees an
HTTP code, a server message or "failed to load"; the detail goes to the log
(`load.failed`, `household.load-failed`). One component and one copy table:
`shared/LoadErrorLine.jsx` and `shared/loadErrorCopy.js`. A source that merely
did not answer inside a search keeps its own status line ("Plex did not answer",
Retry).

**Alignment details.** Tile titles reserve two lines so every meta line in a row
sits on one baseline; the gear rides the header's right edge whether or not the
house indicator shows; the Devices grid uses equal-width columns; Browse names a
source by its human name ("Movies & TV", not `plex`) and shows a single Home
crumb (an extra Back crumb appears only when Back would land somewhere other
than Home); artwork-less rows show a quiet centred initial.

**One destination, one title.** The header's destination control is the only
place the aim is shown; Browse lists and Now Playing do not repeat "Playing on
<name>" (a phone keeps one line inside Now Playing, where the header is out of
thumb reach). Now Playing carries one title block (title, then the show/album and
position), shows a video's own poster in the video area until it plays, shows no
art box when there is no artwork, and lists Shuffle and Repeat once, in the queue
header. A disabled Add only is a quiet text button; its reason is its tooltip and
accessible description. Browse rows without artwork lead with a real icon per
source (`browse/sourceIcons.jsx`), never a letter tile, and two source roots that
read the same are one row.

**Header, scope and house indicator.** The destination control ("Playing on
<name> ⌄", `cast/CastTargetChip.jsx`) leads the header at every width. Scope
is one segmented control, the same 44 px height as the search field. The house
indicator hides at 0, otherwise "N playing" with a small dot at the same height.

**Handle and rail.** The bottom handle names what is there — art, title, and
the state in words ("Ready to play", "Paused", "Playing on <this browser>") —
with **Resume** as its one amber control when ready or paused (the word shows
from 480 px up; on a narrower phone the amber play glyph, still named Resume,
leaves the title the room). The rail keeps Home / Browse / Devices; the selected
item is text colour with a 3 px amber left marker, the others muted.

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
│ DOCK  Playing on Mac ⌄  All Video Music Books  [search…]    │
│                                   • 2 playing, 1 paused   ⚙ │
├──────┬─────────────────────────────────────────────────────┤
│ NAV  │  CANVAS                                             │
│ Home │    one of: Home · Browse · Detail · Now Playing ·   │
│Browse│            Devices · Remote (+ Screens, Routines)    │
│ Devs │                                                     │
├──────┴─────────────────────────────────────────────────────┤
│ outcome rows (overlay: one per attempt, never in the page)  │
│ handle: art · title + state · Resume/Pause · next · stop · ⋯ │
│ phone only: tab bar  Home · Browse · Devices · Search       │
└────────────────────────────────────────────────────────────┘
```

**The dock is the app's constant.** It carries:

- the **search bar** with the scope control (All / Video / Music / Books, a
  text-weight and underline segmented control) — search is always
  one keystroke away (`/` focuses it on a laptop and opens it on a phone),
  never a destination page; results drop down inline. A row tap plays a
  playable item at the aim and opens a container in Browse; containers carry a
  trailing ▶ (play the whole thing) and playable items a trailing ⋯ (**Play**,
  **Play next**, **Add to queue**, **Play on…**, Open detail, favourite and
  watched marks),
- the **house indicator** — "N playing" (and "M paused"), an at-a-glance
  summary of the house that opens **Devices**; it is hidden when nothing is
  playing or paused, and its words, not the small dot, carry the state,
- the **destination control** — "Playing on <name> ⌄": where a plain Play goes
  (this browser's own name, "this device" when it has none, the named screen,
  or "Kitchen + Living Room"). It absorbs the old cast icon: tapping it opens
  the cast preferences (preferred devices, move or keep playing here too), and
  the same destination line ("Playing on …") opens the one destination picker
  in Search Mode, on Browse and Detail, and on **Now Playing**. A machine name
  ("Browser 4778f429") is never shown: an unnamed browser reads "this device"
  for its owner and "a browser" to everyone else. An
  aim on a screen has a two-hour inactivity lease; verified matching playback
  that this browser sent or is steering suspends that lease; stale or unknown
  receiver state does not. Restoration resolves expiry before first layout so
  an expired screen never flashes as the active destination. Opening or leaving
  a screen's **Remote** never changes the aim,
- the **settings menu** — rename this device, Screens, Routine history, Start
  fresh (itemised and confirmed).

The same words are used everywhere: **Play**, **Play next**, **Add to queue**,
**Play on…**, **Move to…** and **Remote**.

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
unchanged source; **Keep playing here too** never stops it. The Now Playing
hand-off uses the same destination as the Remote's Move to…: the typed
hand-off when the screen has a playback owner to capture, else (an idle
screen, which answers `INVALID_CAPTURE`) the ordinary adopt load, counted as
adopted only once the screen itself reports the same item playing
(`cast/screenMove.js` `createScreenMoveDestination`, shared by `useHandOff`).
The screen's copy starts at this device's spot, not at 0:00 (PLACE.8a/AC2).

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
│ ▶ Aim: This device                      │
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
**Play on…** (send one item to a screen other than the aim) is in every
result's ⋯ menu; with an idle screen the tile tap itself sends it (three taps:
⋯, Play on…, the screen), and the outcome row names where it went with Undo.
A plain play has no session to move, so no Move option is shown; a screen that
is busy shows its warning and waits for the confirm button, as do Move
(hand-off) and several screens. The house indicator stays in the phone dock beside the
launcher; the Devices tab carries the playing-count badge as well. The phone's
bottom tab bar also carries **Search** (it opens this same Search Mode), so
the one-handed reach to search, play/pause and the aim does not depend on the
top of the screen.

Every search surface consumes one lifecycle value:
`SearchState = { query, scope, sources, results, phase, failedSources }`, where
`phase` is exactly `idle | loading | partial | complete | failed`. A new query
generation retires older callbacks, while widening may retain already observed
source failures. Pending, partial, failed and widened states therefore use the
same wording and ordering on the dock, Search Mode and destination picker: a
named source failure and its Retry action appear before any wider result claim,
and a settled empty result cannot still present as loading.

At tablet-up widths the dock shows the persistent search bar (with inline
scope chips), the aim line and the house indicator. On a laptop the aim label,
chips and field get room to read in full (no clipped chip or truncated name).
The left search icon remains `pointer-events: none` — it is decoration, never
a tap target.

### Comfortable use, size parity and screen input

Measured on the running app at 360, 390, 820 and 1440 px by
`media-app-p0-accessibility.runtime.test.mjs` (RELY.11a, RELY.12a, RELY.13a,
NF-A11Y, NF-DEV):

- **Every function at every size.** Search, the aim, play/pause, the house
  menu, favourites, Remote, Move to…, the sleep timer and the rest are present
  at phone width; layout differs, capability does not. No page scrolls
  sideways.
- **44 px hit targets**, portalled menu items, dialog buttons and tray rows
  included (the Mantine theme sets the floor for Buttons, icon buttons, inputs,
  menu items, checkbox rows and the dialog close). A disabled control is not a
  target.
- **Keyboard.** Tab reaches every enabled control in reading order with a
  visible focus ring; `/` focuses search (or opens it on a phone); Esc closes a
  menu, dialog or search and returns focus to what opened it. /media has no
  gamepad layer — that requirement belongs to the arcade menu only.
- **Announcements.** Each outcome is announced once through one polite live
  region (the outcome tray's announcer); ticking values (a sleep time left, a
  countdown's seconds) are `aria-hidden`; every state is also written in words
  (Playing, Paused, Off, Uncertain, …), never by colour alone.
- **Large text.** At 200 % text nothing is clipped or overlapped: the dock
  grows and wraps, the seek bar keeps its track and puts a reason on its own
  line, the handle's controls stay on screen.
- **Reduced motion.** Under `prefers-reduced-motion` the shell, menus, dialogs
  and the search dropdown stop animating (spinners keep turning).
- **Contrast** of text and confirmations is at least 4.5:1; the aim line is
  14 px or more. The edge of every control you press or type in (search field,
  destination control, secondary and transport buttons, scope chips) is at
  least 3:1 against what is behind it. The edge uses `--media-control-line`
  (the ramp's dimmed grey, no new colour and no amber); the quiet `--media-line`
  hairlines between regions are unchanged.
- **One thumb on a phone.** Search (tab bar), play/pause (handle) and the aim
  (tappable on Now Playing, and its picker) are all in the lower 60 % of the
  screen; none needs two hands.
- **Notices never take page space.** Measured layout shift while an outcome
  row leaves is under 0.02.

**Screens on the TV (Shield/FKB) accept only the D-pad, OK (Enter) and an
unreliable Back** (FKB swallows Esc). Every prompt a screen shows is therefore
operable with arrows and OK alone: the next-episode countdown takes focus on
**Cancel** (arrows move to **Play now**, OK presses, Back cancels as well);
**Put it back** is pressed by OK while it is on screen; the sleep fade offers
**Keep playing** (OK); **Show briefly** holds focus on **Close** (OK or Back closes
and the programme returns; arrows and play/pause still reach the Player, so a
call or doorbell overlay appearing meanwhile keeps the D-pad). OK on a prompt
yields to any other control that holds focus or any overlay that is up, and
**Put it back** on a "paused by" note is not claimed (OK already resumes). The end-of-queue notices and the music plaque are
informational and need no input. Journeys: `screen-tv-input.runtime.test.mjs`.

### Views

| View | Purpose | Reached from |
|---|---|---|
| **Home** | The start page: Resume, Playing now on other screens, this screen's suggestions (Favourites, Carry on, Usually (here) at this time, New) and the household's Recent — see [The start page](#the-start-page-and-the-households-memory). | Default; nav; breadcrumb. |
| **Browse** | Hierarchical catalog listing with artwork or a recognisable placeholder, kind labels, natural part ordering, and a breadcrumb containing every parent. Long collections page automatically as the end approaches; there is no separate load-more hunt. Pages are 50 titles: `GET /api/v1/list/...?take=50&skip=N` returns `{ items, total }`, and for Plex path containers (e.g. `library/sections/6/all`) the page is fetched from Plex itself (`X-Plex-Container-Start/Size`), so a 2,800-title library opens in ~0.3 s instead of sending every title. Each history entry owns `{ path, scrollTop, focusedId, loadedCount }`, captured before drilling into a container or opening Detail through either Details or More → Open detail. Back re-fetches `loadedCount` rows in one request (capped at 1,000) so a row the person had scrolled to exists again, then restores the exact prior collection viewport and triggering row focus. `loadedCount` is a viewport snapshot like `scrollTop`: re-selecting the Browse area ignores it when matching the original root entry. A specific container adds Play / Shuffle / Add at the top and names the current destination. | Nav; container rows; container taps in search. |
| **Detail** | One item: artwork, what it is and how long ("Movie · 1 hr 56 min", "TV Show · 12 episodes"), description (the source's summary when it has no description), how far each screen has got, full action row (Play Now / Play Next / Play First / Add / Cast), favourite and watched marks. | Browse rows; search results; any item's Details. |
| **Now Playing** | Full local transport: seek bar, prev/play-pause/next/stop, volume, the queue panel, the tappable aim line, and the same session controls as a screen's Remote. Hosts the visual output of the player. | The handle; Escape/Back returns (the Back button names where it goes, e.g. "Home" with a back chevron). |
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
