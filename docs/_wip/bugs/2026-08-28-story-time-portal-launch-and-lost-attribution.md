# Story time: the Portal cannot start it, the TV wakes to the wrong screen, and the read is credited to nobody

**Date:** 2026-08-28
**Found by:** field observation — a learner ran the full story-time flow and a
grown-up watched every step of it
**Status:** diagnosed, not fixed. Root causes confirmed against the log store.
**Severity:** story time completes on screen and records **nothing**. A child
does the work; the obligation never moves.
**Reference:** `docs/reference/school/reading-sessions.md`

---

## What was observed

Three complaints, in the order they happened:

1. The learner typed their code on the Portal. It answered *"Story time happens
   on the living room TV — tap your card there."* **But there was a green
   button.** Pressing it did nothing useful. The expectation was that the green
   button would do what tapping the card in the living room does — start the
   session on the TV — instead of sending a child to repeat the same gesture in
   another room.
2. When they finally *did* tap the card at the living-room reader, **the TV
   turned on but did not show their card.** It came up on something else.
3. A book was scanned and the story started playing — but **it is unclear
   whether it is being credited to them.**

All three are real. The third is the serious one, and it is a direct
consequence of the second.

---

## Answer to the third question, first

**No. It is not being credited, and it cannot be.**

The screen froze this story's attribution as `learnerId: null` at pick time.
Attribution is written once, at countdown expiry, and is deliberately never
re-read afterwards — so nothing downstream could have repaired it.

**It turned out worse than that.** The completion never fired at all. Had it
fired, the POST would have carried a null learner and `RecordStoryRead` would
have rejected it with `learnerId is required to record a story read` — at least
putting *"I couldn't save that one"* on the screen. Instead neither `ended` nor
`clear` reached the widget (see the endgame section below), so the story ended,
the Player vanished, and **nothing was said to anyone**. Two independent faults,
each sufficient on its own to lose the read.

The log store shows the null directly. The two events that carry the screen's
own idea of who is reading have **no `learnerId` field at all**, while the
backend's events for the same moments correctly say the learner's id:

| Time (UTC) | Event | Source | `learnerId` |
|---|---|---|---|
| 17:11:40.031 | `school.reading.session-open` | backend | `alan` |
| 17:11:59.634 | `school.reading.session-opened` | backend | `alan` |
| 17:12:46.090 | `school.reading.pick` `book-selected` | **screen** | **absent** |
| 17:12:47.175 | `school.reading.book-selected` | backend | `alan` |
| 17:12:52.187 | `school.reading.pick` `countdown-expired` | **screen** | **absent** |
| 17:12:52.859 | `school.reading.playback` `playback-started` | **screen** | **absent** |
| 17:12:53.964 | `school.reading.playback-started` | backend | **absent** |

The backend knew it was Alan the whole time. The screen never did.

---

## The causal chain

These are not three bugs. They are one design gap and one stub, and the second
observation causes the third.

### Defect A — the broadcast is sent before the screen can hear it

`makeReadingSessionHandler` opens the session first and wakes the TV second:

```js
const session = sessions.open({ location, learnerId, target });  // broadcasts session-open NOW
...
woke = await wakeScreen({ target, location });                   // TV powers on AFTER
```

`ReadingSessionService.open()` broadcasts `session-open` on `reading:<location>`
inside that first call. The TV was off. `wakeScreen` then took **19 seconds** to
power the display and bring the kiosk forward — the gap between `session-open`
at 17:11:40 and `session-opened` at 17:11:59 is exactly that wake.

The broadcast is fire-and-forget over WebSocket. There is no listener, no
replay, no retry. It was delivered to nobody.

### Defect B — the screen never re-syncs, so it stays idle forever

`useReadingSession` is a **pure subscriber**. Its entire state source is:

```js
useWebSocketSubscription(readingTopic(location), handle, [handle]);
```

There is no snapshot fetch on mount and none on reconnect. A screen that was
asleep during `session-open` starts in `idle`, and `idle` is where it stays
until the *next* message on that topic happens to arrive.

`ReadingSessionScreen` renders `null` in `idle` — by design, so the living-room
menu and screensaver are untouched by the widget existing. The living-room
screen config runs the ArtMode screensaver with `showOnLoad: true`. So the TV
powered on, loaded the screen, painted a framed painting, and the reading widget
sat inert underneath it.

**That is observation 2.**

*(A retraction: an earlier draft cited the absence of the widget's
`screensaver-cleared` line as proof the view never left `idle`. That evidence is
void — `readingLog.screen` emits at **debug**, the Logger's default level is
`info`, and the store holds **zero** debug-level frontend events for the entire
day. Its absence can prove nothing. The claim it supported was also wrong: the
view DID leave `idle` at 17:12:46 when the book was scanned, the effect fired,
and the screensaver was dismissed then — which is why the child saw a countdown
at all. What is true, and what the valid evidence below shows, is that the view
stayed `idle` through the **prompt** phase: the screen's own `session-open` line
is info-level and is genuinely absent.)*

### Defect C — the pick adopts a learner the screen never learned

When the book was finally scanned at 17:12:46, the interceptor broadcast
`book-selected` — and that payload **does carry the correct `learnerId`**, read
straight off the session:

```js
this.#broadcast(location, { event: 'book-selected', learnerId, location, ...pick })
```

The hook throws it away. Its `book-selected` branch reads only `payload.contentId`
and then attributes from a ref that `session-open` was supposed to have filled:

```js
readingLog.pick('book-selected', {
  contentId, from: previous?.contentId ?? null,
  learnerId: learnerRef.current?.id ?? null,   // ← still null; session-open was missed
});
```

`commitPick` then freezes `learnerId: who?.id ?? null` into `attributionRef` and
starts the story anyway. **Nothing refuses to play a story that cannot be
credited.**

**The information needed to self-heal was already in the message the screen did
receive.** It was discarded.

### Defect D — the Portal's green button is a stub that was never revisited

Separately from the above: `StoryTimeProgramLauncher.launch()` is a hardcoded
refusal, and says so in its own comment:

```js
/**
 * Story time happens at the TV, not on the Portal. Until the living-room
 * reading session ships (plan 03) this is a sentence, not a dispatch.
 */
async launch() {
  return { decision: 'failed', message: AT_THE_TV };
}
```

**The living-room reading session has shipped.** It is what the learner used
twenty seconds later. The launcher was never updated, so the Portal still offers
a primary (green) action whose only possible outcome is a refusal —
`school.selfservice.program.not-dispatched`, `outcome: failed`, at 17:10:55.

This is a button that is guaranteed to fail, presented as the thing to press.
It is worse than no button: the child pressed it, it did nothing, and *then*
they were told to walk to another room and repeat themselves.

The dispatch is entirely feasible. Everything needed is already declared:

- `StoryTimeProgramLauncher.entryAction` → `'reading-session'`
- `triggers/sources.yml` → the `livingroom` source declares
  `learner_action: reading-session` and `target: livingroom-tv`
- `learnerActions` already has `reading-session` registered against exactly that
  handler

The only missing piece is a projection from an entry action to the **locations
that declare it**. `declaredEntryActions()` currently collapses the config to a
bare `Set` of action names and discards the location — which is all reachability
needed, and not enough to dispatch.

---

## The fix already exists in this codebase — on the other path

`ScreenPlaybackAdapter`, the media-lesson dispatcher, solves Defects A and B
exactly. Same room, same Shield, same WebSocket transport, and its header
explicitly cites the reading path as the precedent it learned the wake trick
from. Its `dispatch()`:

```js
await this.#wake(screen, sessionId);        // and THROWS if the wake fails
await this.#awaitListener(topic, screen, sessionId);  // polls subscriber count, 5s budget
// only now:
this.#eventBus.broadcast(topic, { type: 'lesson.open', ... });
```

Its documented invariant is *"a screen that is not coming on is never told"*,
and on listener timeout it throws rather than broadcasting into the void —
because a broadcast nobody heard would record the lesson as dispatched against a
dark TV.

The reading path does none of this. It broadcasts first, wakes second, and never
asks whether anyone is listening. **The lesson path was hardened; the reading
path it borrowed from was not back-ported.** That is the whole of Defects A and B.

---

## A consequence nobody has hit yet

When the completion POST fails on the null learner, `POST /reading/read` throws
*before* reaching its session transition:

```js
const read = await recordStoryRead.execute({ ... });   // ← throws here
if (location) sessions.update(location, { state: 'prompt', pick: null, playing: null });
```

So the session stays at `state: 'reading'`. Two rules depend on it leaving:

- The idle sweep **exempts `reading` on purpose** (D6 — a 45-minute audiobook is
  not an empty room). A session stuck at `reading` never expires, so the D8
  suppression of the location's `end: tv-off` holds and **the living-room TV
  stays on indefinitely**.
- The interceptor refuses the next book mid-story with *"Finish this one
  first"* (D5) — while nothing is playing.

Both fire long after the child has left, and neither is visible as a fault.

---

## Update — the endgame, watched live

The story finished at **17:22:30**. A grown-up watched it happen and reported
four more failures. All four are confirmed, and one of them rewrites part of the
diagnosis above.

### The page reloaded — but the wake did not do it

The Shield's own timeline:

```
17:11:40  school.reading.session-open          ← broadcast goes out
17:11:41  gamepad.resume-reseed                ← the WebView resumes
17:11:41  console.error "[WebSocketService] Error:"   ← its data socket is dead
17:12:04  frontend-start                       ← THE PAGE RELOADS ITSELF
17:12:05  ScreenScreensaver  screensaver.show
17:12:05  artmode.mount                        ← the framed painting
```

**An earlier draft of this section blamed the wake, and that was wrong.** Both
mechanisms it proposed are refuted:

- `prepareForContent` did not restart FKB. Its force-stop branch
  (`FullyKioskContentAdapter.mjs:151-170`) is gated on `micBlocked`, and the
  store shows the soft path — `fullykiosk.prepareForContent.micClear` at
  17:11:59.632. No force-stop, no relaunch.
- **`fkb: onResume: restore` in `living-room.yml` is read by nothing.**
  `grep -rn onResume backend/src` returns zero hits. It is inert YAML, and
  citing it as the cause was speculation dressed as a finding.

The actual mechanism is the app's own **`WebSocketService` degraded-mode
auto-reload** (`frontend/src/services/WebSocketService.js:214-222`): after
enough failed reconnects it arms a timer that ends in `window.location.reload()`.
Only `MediaApp.jsx` opts out; the living-room screen does not. The Shield logged
a WebSocketService error 72 ms after the WebView resumed — a TV that has been off
long enough always walks that ladder, its frozen timers thaw on resume, and the
overdue reload fires. Here, 23 seconds later.

The conclusion holds and gets stronger: the widget did not merely miss the
broadcast — **it was destroyed and rebuilt after it**. But the cause is a
property of this kiosk on *every* cold resume, not of the wake. That relocates
fix 8 entirely (see the fix list) and makes fix 2 the only one that can work:
ordering cannot save a widget that reloads itself 23 seconds later.

### No ceremony, because nothing told the widget the story ended

Between 17:12:53 and 17:22:30 the Shield logged nothing but menu perf
snapshots. Then:

```
17:12:52.858  playback.started            duration: 579.717375
17:22:30.837  audio-shader.dimensions     shaderState: on, trigger: state-change
17:22:30.935  audio-shader.dimensions
              (natural end due ~17:22:32.6 — nothing, then or ever)
```

**An earlier draft read those shader events as "an incidental resize" marking
the player's teardown. They are the opposite.** `AudioPlayer.jsx:102` sets
`shaderState` to `on` when `seconds > duration - 2`. That threshold is
`579.717 - 2 = 577.72s` after start — **predicted 17:22:30.56, observed
17:22:30.837.** These are the player's own designed final-two-seconds
transition, and they prove it was *alive, mounted, and on schedule* at T-minus-2.

Nothing marks a teardown at 17:22:30 at all: `screen-presence-publisher`, which
remounted on both earlier view changes, stayed silent. And no
`playback-completed`, no `playback-abandoned`, no `AudioPlayer unmounted`, no
queue advance — ever. Both of the widget's routes out of a story failed to fire:

- the media element's `ended` never reached `notePlaybackCompleted`, and
- the Player's `clear` never reached `notePlaybackDismissed`.

Either would have logged on arrival at info level, and the transport was
demonstrably alive (menu-perf every 5s straight through). So the widget is
**still in `view: 'playing'`**, which renders `null` — and that is why the TV
shows the menu underneath rather than a ceremony.

**What the arithmetic buys is a much narrower unknown.** Not "the terminal path
is unlit" but: *playback stopped inside the final two seconds and `ended` never
fired.* The leading hypothesis is that the stream is fractionally shorter than
the 579.717s Plex reports, so playback ran out before reaching the threshold that
raises `ended`. Two things make that failure invisible by design:
`useCommonMediaController` suppresses stall detection within `duration - 0.5`,
so a stop in that window is neither recovered nor logged. **Checkable:** compare
the Plex item's real stream length against 579.717s.

This also means **the instrumentation added below will not catch a recurrence.**
`playback.ended` only fires if `ended` fires; `single-item-ended` only if `onEnd`
runs. A near-end stop stays exactly as silent as it was. See fix 7.

### The Portal still shows it undone — correctly

This is not a fourth bug. `StoryTimeProgramLauncher.status()` counts rows in the
reading log, and no row was ever written. The Portal is accurately reporting a
read that does not exist. **The system is not confused about the state; the
state is genuinely wrong**, and the count will stay wrong until a row is written
by hand or the story is read again.

### The TV did not power off — but D8 is not the mechanism

The outcome is right and the cause named in the first draft was not.

For a **claimed** pick — which this was — `end: tv-off` is never armed in the
first place: `responseHandlers.content` returns at line 69 on a claim, before
`buildLoadOptions` ever attaches an `endBehavior`. The story played through the
widget's own `showOverlay(Player, …)` with no end behaviour anywhere near it.
`suppressEnd` governs *future unclaimed* dispatches at that location, not this one.

The teardown actually lost is **D6's own `onTimeout` → `tvAdapter.turnOff`**
(`app.mjs:4163-4167`), which the idle sweep never reaches because `reading` is
exempt from `IDLE_STATES`. The session is stuck in `reading` because
`POST /reading/read` transitions it back to `prompt` **only on success**, and
this read never succeeded.

So: a session that cannot expire, holding off the only teardown that would have
fired. One more correction — "the TV will stay on indefinitely" overreaches.
Sessions are keyed per location, so the **next card tap at that reader replaces
this one**, restoring a sweepable `prompt` state; a backend restart clears it
too. The honest claim is *until the next tap or the next restart*.

### Art mode did not come back either

`ScreenScreensaver.show()` returns early whenever `hasOverlay || contentActive`,
reschedules, and — until this patch — **logged nothing when it did so**. So the
screensaver's absence has two candidate explanations (a lingering overlay entry,
or a nav stack that still believes content is up) and the logs could not
distinguish them. Instrumented below; it will name the suppressor next time.

---

## Observability patched (2026-08-28)

Every junction this incident had to be reconstructed by hand is now logged. The
theme: **this feature fails by staying quiet**, so the events worth adding are
the ones that fire when a step *doesn't* happen.

| Event | Where | Answers |
|---|---|---|
| `school.reading.error` `detail: pick-without-session` (**error**) | `useReadingSession` | a book arrived for a session the screen never learned — attribution *will* be null. Carries the learner id the payload was offering. |
| `school.reading.error` `detail: committed-unattributable` | `useReadingSession` | the pick froze with no learner; the story is about to play un-creditable |
| `countdown-expired` now carries `attributable` | `useReadingSession` | a null `learnerId` serialises as an *absent* field, which no query finds. An explicit `false` is greppable. |
| `school.reading.playback` `media-detached` (with `reason`) | `ReadingSessionScreen` | the `ended`/`playing` listeners came off — past here a story can finish in silence |
| `school.reading.playback` `player-cleared` | `ReadingSessionScreen` | tells "`clear` never came" apart from "`clear` came and did nothing" |
| `playback.ended` | `useCommonMediaController` | the media element genuinely ended, with position and duration |
| `single-item-ended` (`action: loop\|clear`) | `Player.singleAdvance` | which branch a finished non-queue item took |
| `screensaver.suppressed` / `.unsuppressed` (`by`) | `ScreenScreensaver` | why art mode is not returning — edge-triggered, so a long film logs twice, not hourly |
| `school.reading.end-suppressed` (`sessionState`) | `readingSessionInterceptor` | whether a session is holding off an *unclaimed* dispatch's `end: tv-off`, and whether that session is healthy |
| `school.reading.session-stuck` (**warn**) | `ReadingSessionService.sweep` | a session parked in `reading` past 90 min — reported, never torn down (tearing down would cut off a real audiobook). Runs **above** the idle-timeout guard, so disabling the timeout cannot disable the watchdog. |
| `school.reading.read-rejected` (**error**) | `POST /reading/read` | a completed story refused server-side; previously invisible because `RecordStoryRead` throws before it logs |
| `school.reading.playing-unattributed` (**warn**) | `POST /reading/playing` | the screen sent no learner — fires ~10 minutes *before* the loss lands. A learner that merely *differs* is D4 working correctly and logs at info (`playing-learner-differs`), not warn. |
| `session-opened` now carries `wakeMs` | `learnerCardActions` | how long the room had no chance of hearing the broadcast. **A plain measurement** — a first draft derived a `broadcastLikelyMissed` boolean from a 1.5 s threshold, which would have fired on every healthy tap (`prepareForContent` takes ~13.5 s on the good path). Whether anyone heard it is a subscriber-count question; see fix 1. |

`readingLog`'s header documents the five new screen-side events and why they
exist. Verified: 913 school/reading/screensaver tests and 516 Player tests pass;
the four reading backend suites (109 tests) pass.

**Not yet fixed** — this pass added instrumentation only. Every behavioural
defect below is still live.

---

## What to fix, in priority order

1. **Wake before you speak** (`makeReadingSessionHandler`). Wake the screen, wait
   for the room to be listening, *then* open the session. Back-port
   `ScreenPlaybackAdapter.#awaitListener` rather than writing a second one.
2. **Give the screen a snapshot** (`useReadingSession`). Fetch the current
   session for this location on mount and on socket reconnect. **This is the
   only fix that actually closes the hole**, because the kiosk reloads itself on
   every cold resume (see the reload section) — ordering cannot help a widget
   rebuilt 23 seconds after the message. Note it needs **new backend surface**:
   `reading.mjs` exposes only `/playing`, `/read` and `/summary`; there is no
   session-by-location GET to fetch.
3. **Trust the payload** (`useReadingSession`). Adopt `payload.learnerId` when
   the ref is empty — from `book-selected` *and* from `session-update`. The
   repair data arrived on the topic **three times**: once in `book-selected`,
   and twice in `session-update` broadcasts (the interceptor's claim at
   ~17:12:47 and the `/playing` POST at ~17:12:53), each carrying the full
   session with `learnerId` on it. The hook's default branch discards
   `session-update` by design ("the session's mirror of it is not an
   instruction") and logs the discard at debug, i.e. invisibly. Until fix 2
   ships, adopting from `session-update` is the closest thing to a snapshot the
   system already broadcasts.
4. **Refuse to play what cannot be credited** (`commitPick`). A null
   `learnerId` should surface a notice, not silently start a story that is
   guaranteed to fail at the finish line. Today this failure is invisible until
   the very end, and its only witness is a four-year-old.
5. **Make the green button real** (`StoryTimeProgramLauncher.launch()`). Add a
   `locationsDeclaring(action)` projection alongside `declaredEntryActions()`,
   and dispatch through the same `reading-session` handler the card tap uses.
   Until then the action should not be *offered* — a guaranteed-failing primary
   button is worse than an honest sentence on its own.
6. **Transition the session even when the read fails** (`POST /reading/read`).
   The stuck-`reading` state above is a separate fault with its own blast
   radius; a failed write must not leave the room lit all night. Pair it with a
   bounded `reading` state — the D6 exemption protects a 45-minute audiobook and
   should not extend to 45 hours.
7. **Add a near-end watchdog, then find out why `ended` never fired.** The
   duration arithmetic localises this to the final two seconds, and the
   instrumentation shipped today **cannot see it**: `playback.ended` fires only
   if `ended` fires. Log `pause`/`waiting`/`stalled` in the terminal stretch, or
   arm a timer at `duration - N` that fires if `ended` has not arrived within
   M seconds. First, cheaply: compare the Plex item's real stream length to the
   579.717s it advertises.
8. **Decide what to do about the kiosk's self-reload**
   (`WebSocketService._startAutoReloadTimer`). A living-room screen whose TV has
   been off walks the degraded ladder, and its overdue reload fires seconds
   after resume. Fix 1's listener-wait has a residual race against it: a resumed
   page can reconnect, satisfy the subscriber check, and *then* execute its
   pending reload. Either exempt this screen (as `MediaApp` does), or cancel the
   timer on a successful reconnect — but fix 2 is what makes it survivable
   either way.

Fixes 3 and 4 are small and independently valuable: together they mean this
incident would have been *loud* instead of silent, even with 1 and 2 unbuilt.
The instrumentation shipped today is what makes 7 answerable at all.

---

## Evidence

Log store, `context.app:api` and `context.component:school-reading`, all times UTC.

```
17:09:41  nfc.tap.school_card / school.card.agenda-printed   alan, 2 offers, 0 sessions created
17:10:45  school.selfservice.code.resolved                   alan, story-time:daily, offered [program, exit]
17:10:55  school.selfservice.action.run                      kind=program  outcome=FAILED
17:10:55  school.selfservice.program.not-dispatched          "Story time happens on the living room TV…"
17:11:40  school.reading.session-open                        alan  ← broadcast to a TV that is off
17:11:59  school.reading.session-opened                      alan  ← wake returns, 19s later
          (no school.reading.session / session-open from the screen — ever)
          (no school.reading.screen / screensaver-cleared    — ever)
17:12:46  school.reading.pick  book-selected     [screen]    learnerId ABSENT
17:12:47  school.reading.book-selected           [backend]   learnerId alan
17:12:52  school.reading.pick  countdown-expired [screen]    learnerId ABSENT  ← attribution frozen null
17:12:53  school.reading.playback-started                    learnerId ABSENT
```

As of writing, no `playback-completed`, no `record-failed`, and no
`school.story-time.read-recorded` for this pick. Whichever way the player ends,
the attribution is already null and the read cannot land.

**Reproduce it:** with the living-room TV **off**, tap a learner card at the
living-room reader, wait for the TV to wake, then scan a book. The prompt never
appears, and `countdown-expired` logs with no `learnerId`. With the TV already
**on and the reading screen mounted**, the same sequence works — which is why
this survived to the field.

---

## Why this was missed

Both halves are "shipped, then the ground moved."

The reading path was written when the screen was assumed to be awake and
mounted — reasonable on a kiosk that is usually on. The wake was added later, as
a courtesy, and slotted in *after* the broadcast because that is where the
handler's flow already put it. Nothing in the tests turns the TV off first; the
`session-open` → widget path is only ever exercised with a listener already
attached.

`StoryTimeProgramLauncher.launch()` is a deliberate, well-commented placeholder
that names the exact plan whose completion should have retired it. Plan 03
shipped. Nothing linked the stub to the milestone that obsoleted it, and its
tests assert the refusal — so the placeholder is now pinned in place by a test
that says it is correct.
