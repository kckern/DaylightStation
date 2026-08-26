# Living-Room Reading Session Screen — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Prerequisites: plans 01 and 02 must be merged and deployed.** This plan registers the `reading-session` learner action that plan 01 deliberately left unregistered, and it feeds the reading log that plan 02 built.

**Goal:** A child taps their own card on the living-room reader; the TV opens a screen scoped to them showing their avatar, today's count and what they read yesterday. They tap a book; the screen confirms the pick with a countdown they can change their mind during; then it plays. When it finishes, the read is recorded, the ceremony fires, and their School tile goes green.

**Architecture:** A `ReadingSessionService` holds "who is at the living-room reader" as in-memory state keyed by trigger location. The `reading-session` learner action sets it, wakes the TV and broadcasts to the screen. While a session is open, a **content interceptor** — a new seam in `responseHandlers.content`, mirroring the existing `contentDispatcher` hook — claims book taps at that location instead of dispatching them, so the screen can run the countdown and issue the play itself. The screen's player reports completion, which writes the reading log via plan 02's `RecordStoryRead`.

**Tech Stack:** Node ESM backend; React + the screen framework on the frontend; the existing WebSocket event bus.

**Learner ids:** use `learner-c` / `learner-d` in code, tests and docs. Real roster ids only in config under `$DAYLIGHT_BASE_PATH`.

**Read first:**
- `docs/reference/trigger/events.md` — the `trigger:<location>:<modality>` broadcast shape the screen subscribes to
- `frontend/src/screen-framework/widgets/builtins.js` + `registry.js` — how a widget is registered
- `frontend/src/modules/School/selfService/useScanCeremony.js` — the ceremony pattern and its `school`-topic precedent
- `backend/src/3_applications/trigger/responseHandlers.mjs` — the `content` handler and its existing `contentDispatcher` seam
- `$DAYLIGHT_BASE_PATH/data/household/screens/living-room.yml` — the screen this mounts on

---

## Design decisions — all settled 2026-08-26

**The full state machine is `docs/reference/school/reading-sessions.md`. Read it
before writing any code in this plan; it is the authority on behaviour and it
enumerates every state, input and transition.** What follows is only what changes
about the implementation.

**A session has a MODE, derived on every evaluation and never stored:**
`assignment` when the learner is enrolled in story-time and `count < target`;
`browsing` otherwise. The two differ in exactly one cell of the transition matrix —
a book tapped mid-story. Assignment refuses it; browsing does not claim it and the
existing preempt/on-deck queue applies unchanged.

That single branch is why the mode exists, and it removes several things this plan
originally had to design:

- **A non-enrolled card needs no special case** — it is simply always in browsing
  mode. Delete any "is this learner enrolled" refusal.
- **The confirm countdown never competes with the 15 s preempt window**, because in
  assignment mode nothing reaches the queue while a story plays.
- **The on-deck ownership question disappears in assignment mode.** No queue, no
  on-deck, nothing silent.

**The session is the screen.** Last card tap wins; a different card swaps context.

**A card tapped mid-story switches context but does NOT stop the story**, and the
story is credited to whoever **picked** it. Attribution is decided at pick time, or
a sibling wandering past the reader could steal a read.

**The interceptor is a seam in the content handler, not a branch in the resolver.**
`responseHandlers.content` already has an injected `contentDispatcher` hook for the
same reason. A book tag stays a book tag with `action: play-next`; what changes is
who gets first refusal on dispatching it.

**Session state is in-memory and per-location.** It is not evidence — the reading log
is. A backend restart loses "who is standing at the reader", which is correct.

### The three that add work to this plan

**Completion ends the session.** Target met → ceremony → teardown → TV off. To read
more, re-tap the card, which reopens in browsing mode. Tasks 6 and 7 must sequence
the ceremony *before* teardown.

**⚠ `end: tv-off` must be suppressed while a session is open (D8).** The `livingroom`
location is configured `end: tv-off`, which fires when content ends
(`WakeAndLoadService.mjs:275` → `sideEffectHandlers['tv-off']`). Left unmodified **it
powers the TV off the instant a story ends, before the ceremony can render.** This is
a live hazard in the current config, not a design option. Add a test.

**An idle session times out (D6).** ~2 minutes quiet at `PROMPT` or `CONFIRM` →
teardown → TV off, the same teardown a finished session runs. Without it the TV stays
on all night and the next tap lands in a stale session.

### Smaller settled behaviours to implement

| # | Behaviour |
|---|---|
| D2 | A card tapped while unrelated content plays: **refuse, visibly**. Brief on-screen acknowledgement; content keeps playing. A session never seizes the TV. |
| D3 | A different card during the countdown: swap learner and **drop the pick**. |
| D7 | Any tap during `CELEBRATE`/`TEARDOWN` **cancels teardown**. |
| D9 | An unregistered book tag inside a session: say so on screen, **and** still write the observed-registry entry and send the phone push. |
| D10 | The same book tapped again during the countdown: **confirm immediately**, skipping the rest. The 3 s dedup window would otherwise swallow it. |
| — | A book already read today **counts again**. No repeat suppression; the reading log needs no `repeat` flag. |

---

### Task 1: `ReadingSessionService`

**Files:**
- Create: `backend/src/3_applications/school/ReadingSessionService.mjs`
- Test: `tests/isolated/application/school/ReadingSessionService.test.mjs`

**Step 1: Write the failing test**

```js
import { ReadingSessionService } from '#apps/school/ReadingSessionService.mjs';

const silent = { warn() {}, info() {}, error() {}, debug() {} };

it('has no session at a location until a card opens one', () => {
  expect(new ReadingSessionService({ logger: silent }).current('livingroom')).toBeNull();
});

it('opens a session for a learner at a location', () => {
  const s = new ReadingSessionService({ clock: () => new Date('2026-08-26T18:00:00Z'), logger: silent });
  s.open({ location: 'livingroom', learnerId: 'learner-c' });
  expect(s.current('livingroom')).toMatchObject({ learnerId: 'learner-c', location: 'livingroom' });
});

it('a second card REPLACES the first — last tap wins', () => {
  const s = new ReadingSessionService({ logger: silent });
  s.open({ location: 'livingroom', learnerId: 'learner-c' });
  s.open({ location: 'livingroom', learnerId: 'learner-d' });
  expect(s.current('livingroom').learnerId).toBe('learner-d');
});

it('scopes sessions per location', () => {
  const s = new ReadingSessionService({ logger: silent });
  s.open({ location: 'livingroom', learnerId: 'learner-c' });
  expect(s.current('study')).toBeNull();
});

it('closes a session', () => {
  const s = new ReadingSessionService({ logger: silent });
  s.open({ location: 'livingroom', learnerId: 'learner-c' });
  s.close('livingroom');
  expect(s.current('livingroom')).toBeNull();
});

it('broadcasts the open so the screen can render it', () => {
  const sent = [];
  const s = new ReadingSessionService({
    eventBus: { broadcast: (t, p) => sent.push({ topic: t, payload: p }) }, logger: silent,
  });
  s.open({ location: 'livingroom', learnerId: 'learner-c' });
  expect(sent[0]).toMatchObject({
    topic: 'reading:livingroom',
    payload: { event: 'session-open', learnerId: 'learner-c' },
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/application/school/ReadingSessionService.test.mjs --reporter=dot`
Expected: FAIL — module not found

**Step 3: Write the implementation**

A `Map` of location → `{ learnerId, location, openedAt }`, plus `open`/`close`/`current`, each broadcasting on `reading:<location>`. Wrap every broadcast in try/catch — a dead bus must never make `open` throw, because `open` is called from a card tap that has to answer.

**Step 4 / Step 5: Run and commit**

```bash
npx vitest run tests/isolated/application/school/ReadingSessionService.test.mjs --reporter=dot
git add backend/src/3_applications/school/ReadingSessionService.mjs tests/isolated/application/school/ReadingSessionService.test.mjs
git commit -m "feat(school): reading session state, keyed by trigger location"
```

---

### Task 2: The content interceptor seam

**Files:**
- Modify: `backend/src/3_applications/trigger/responseHandlers.mjs` (the `content` handler)
- Test: `tests/isolated/application/trigger/contentInterceptor.test.mjs`

**Step 1: Write the failing test**

```js
import { responseHandlers } from '#apps/trigger/responseHandlers.mjs';

const silent = { warn() {}, info() {}, error() {}, debug() {} };
const RESPONSE = {
  kind: 'content', target: 'livingroom-tv', location: 'livingroom',
  expression: { action: 'play-next', contentId: 'plex:620681', options: {} },
  posture: 'authoritative',
};

it('dispatches normally when no interceptor claims the content', async () => {
  const loaded = [];
  await responseHandlers.content(RESPONSE, {
    wakeAndLoadService: { execute: async (t, q) => { loaded.push({ t, q }); } },
    contentInterceptors: [{ claim: async () => null }],
    logger: silent,
  });
  expect(loaded).toHaveLength(1);
});

it('does NOT dispatch when an interceptor claims it', async () => {
  const loaded = [];
  const result = await responseHandlers.content(RESPONSE, {
    wakeAndLoadService: { execute: async () => { loaded.push(1); } },
    contentInterceptors: [{ claim: async () => ({ claimed: true, by: 'reading-session' }) }],
    logger: silent,
  });
  expect(loaded).toEqual([]);
  expect(result).toMatchObject({ claimed: true, by: 'reading-session' });
});

it('dispatches normally when an interceptor throws — a broken claim must not eat the tap', async () => {
  const loaded = [];
  await responseHandlers.content(RESPONSE, {
    wakeAndLoadService: { execute: async () => { loaded.push(1); } },
    contentInterceptors: [{ claim: async () => { throw new Error('boom'); } }],
    logger: silent,
  });
  expect(loaded).toHaveLength(1);
});

it('consults interceptors in order and stops at the first claim', async () => {
  const seen = [];
  await responseHandlers.content(RESPONSE, {
    wakeAndLoadService: { execute: async () => {} },
    contentInterceptors: [
      { claim: async () => { seen.push('a'); return { claimed: true }; } },
      { claim: async () => { seen.push('b'); return null; } },
    ],
    logger: silent,
  });
  expect(seen).toEqual(['a']);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/application/trigger/contentInterceptor.test.mjs --reporter=dot`
Expected: FAIL — content is dispatched in the claimed case

**Step 3: Write the implementation**

At the top of `responseHandlers.content`, before the posture branch:

```js
    // First refusal on a content dispatch. The reading session uses this to
    // claim a book tap at a location where a child has a session open, so the
    // screen can confirm the pick before anything plays.
    //
    // A THROWING INTERCEPTOR NEVER EATS THE TAP. It is logged and skipped, and
    // the book plays as it always did — the failure mode of this seam must be
    // "the old behaviour", never "the TV does nothing".
    for (const interceptor of deps.contentInterceptors ?? []) {
      try {
        const claim = await interceptor?.claim?.(response);
        if (claim?.claimed) {
          deps.logger?.info?.('trigger.content.claimed', {
            by: claim.by ?? null, target: response.target, contentId: response.expression?.contentId,
          });
          return claim;
        }
      } catch (err) {
        deps.logger?.warn?.('trigger.content.interceptor_failed', { error: err.message });
      }
    }
```

`Response.content` must also carry `location` — add it to the factory in `Response.mjs` and pass `intent.location` through `mapIntentToResponse`, so an interceptor can scope itself to a reader. Extend `tests/isolated/domain/trigger/Response.test.mjs` accordingly.

**Step 4 / Step 5: Run and commit**

```bash
npx vitest run tests/isolated/application/trigger/ tests/isolated/domain/trigger/ --reporter=dot
git add backend/src/3_applications/trigger/responseHandlers.mjs backend/src/2_domains/trigger/Response.mjs backend/src/3_applications/trigger/mapIntentToResponse.mjs tests/isolated/
git commit -m "feat(trigger): content interceptor seam, scoped by reader location"
```

---

### Task 3: The reading-session interceptor

**Files:**
- Create: `backend/src/3_applications/school/readingSessionInterceptor.mjs`
- Test: `tests/isolated/application/school/readingSessionInterceptor.test.mjs`

**Behaviour — MODE-AWARE.** This is the one place the assignment/browsing split
actually lands in code:

- No session at `response.location` → return `null`. The book plays as it does today.
- Session open, **nothing playing** (`PROMPT`) → claim, broadcast `book-selected`.
- Session open, **story playing**, mode `assignment` → **claim and refuse** (D5).
  Broadcast a `book-refused` so the screen can say "finish this one first". Claiming
  is what stops it reaching the queue; refusing is what the child sees.
- Session open, **story playing**, mode `browsing` → return `null`. The existing
  preempt/on-deck rules apply unchanged.

**Step 1: Write the failing test**

```js
it('claims a book tap when a session is open and nothing is playing', async () => { /* ... */ });
it('does NOT claim when no session is open — a book tapped by a grown-up still just plays', async () => { /* ... */ });
it('does NOT claim a tap at a different location', async () => { /* ... */ });
it('carries the learner and the content id in the broadcast', async () => { /* ... */ });
it('claims AND refuses a mid-story tap in assignment mode', async () => { /* ... */ });
it('does NOT claim a mid-story tap in browsing mode — the queue still owns it', async () => { /* ... */ });
it('derives mode from the reading log, not from stored session state', async () => { /* ... */ });
```

**Step 2-5:** implement, run `npx vitest run tests/isolated/application/school/readingSessionInterceptor.test.mjs --reporter=dot`, commit.

---

### Task 4: Register `reading-session` as a learner action

This is the registration plan 01 deliberately withheld.

**Files:**
- Modify: `backend/src/5_composition/modules/learnerCardActions.mjs` (created in plan 01, Task 9)
- Modify: `backend/src/app.mjs` — construct `ReadingSessionService`, register the action, pass the interceptor into `createTriggerApiRouter`

**Behaviour of the handler:** open the session, wake the target TV via `wakeAndLoadService` onto the living-room screen's reading route, and return `{ status: 'reading_session_open', learnerId }`.

**Verify:** `npm run check:parse`, then `npx vitest run tests/isolated/composition/ --reporter=dot`.

After this task, a card tapped in the living room stops answering `no_handler` and opens a session instead. Commit.

---

### Task 5: The `school-reading` screen widget

**Files:**
- Create: `frontend/src/modules/School/reading/ReadingSessionScreen.jsx`
- Create: `frontend/src/modules/School/reading/ReadingSessionScreen.scss`
- Create: `frontend/src/modules/School/reading/useReadingSession.js`
- Modify: `frontend/src/screen-framework/widgets/builtins.js`
- Test: `frontend/src/modules/School/reading/ReadingSessionScreen.test.jsx`

**States the component must render, all four:**

| State | What the child sees |
|---|---|
| `idle` (no session) | The living-room screen's normal menu — this widget renders nothing |
| `open` | Their avatar, their name, "What do you want to read today?", today's count (`1 of 2 stories`), and what they read yesterday |
| `picking` | The chosen book's cover, its title, a visible countdown, and "tap another book to change your mind" |
| `playing` | Hands off to the player; the widget is out of the way |

**Logging is not optional** (see `CLAUDE.md` §Logging). Use a `readingLog` category facade following `frontend/src/modules/Feed/Scroll/feedLog.js`. Log at minimum: `session-open` (learnerId), `book-selected` (contentId), `pick-changed`, `countdown-expired`, `playback-started`, `playback-completed`, `record-failed`. Never raw `console.*`.

**Countdown:** reuse the existing RAF countdown hook rather than a fresh `setInterval` — see `docs/_wip/plans/2026-02-14-raf-countdown-hook.md` and the `confirmRemainingMs`/`confirmTotalMs` pattern `LaunchCard.jsx` already uses for exactly this shape of UI.

**Sound effects:** the living-room display is the Shield running Fully Kiosk's Android WebView. There is **no autoplay gate to design around** — book taps already start audible playback there with no user gesture anywhere in the loop (NFC tap to HTTP trigger to content load), so if the WebView enforced one the existing audiobook feature would not work. The only open question is narrower: whether a short programmatic `Audio.play()` cue behaves like the media element the Player mounts. Answer that on the device, not by analogy with any other kiosk in the house.

**Test with vitest + Testing Library**, driving the hook with mocked WS payloads. Commit per state.

---

### Task 6: Record the read on completion

**Files:**
- Create: `backend/src/4_api/v1/routers/reading.mjs` — `POST /api/v1/school/reading/read`
- Modify: `frontend/src/modules/School/reading/ReadingSessionScreen.jsx` — call it from the player's completion handler
- Test: `tests/isolated/api/routers/reading.test.mjs`

The endpoint takes `{ learnerId, contentId, title, tagUid, location }` and calls plan 02's `RecordStoryRead`. **Attribution comes from the session as it stood when the book was PICKED**, carried through the screen's own state — never re-read from the session at completion time, or a card tapped during the story would re-credit it.

**Guard against double-counting:** a player that fires `onEnded` twice, or a screen that remounts mid-book, must not log two reads. Send a client-minted `pickId` with the read and have `RecordStoryRead` ignore a `pickId` already present in that learner's day shard. Add a test for it — this is the single most likely field bug in the whole plan set.

Commit.

---

### Task 7: The completion ceremony

Plan 02's `RecordStoryRead` already broadcasts `story-read` on the `school` topic. Extend `frontend/src/modules/School/selfService/useScanCeremony.js` to render it, following the `piano-lesson-complete` precedent already in that file — read its header comment first, it explains exactly when a ceremony should and should not appear.

Add a test to the existing ceremony suite. Commit.

---

### Task 8: Mount the widget and document

**Files:**
- Modify: `$DAYLIGHT_BASE_PATH/data/household/screens/living-room.yml` — add the reading widget to the layout
- Modify: `docs/reference/school/README.md` and `docs/reference/trigger/schema.md`
- Create: `docs/reference/school/reading-sessions.md` — the flow end to end, the attribution rule, and the interceptor seam
- Modify: `docs/docs-last-updated.txt`

---

## Acceptance — verify on the real hardware, not only in tests

Per memory `feedback_dont_assert_unverified_device_facts` and `feedback_screenshots_over_code_agents_for_ui_triage`: this plan ends at a TV in a room. Ask KC for a photo of each state rather than inferring from code that it paints.

1. Tap a preschooler's card on the living-room reader → TV wakes, their avatar and prompt appear
2. Tap a book → countdown appears with the cover
3. Tap a different book during the countdown → the pick changes, the countdown restarts
4. Let it expire → the book plays
5. Let the book finish → the read is logged, the ceremony fires, `ops status` shows `1 of 2 stories`
6. Repeat to the target → the School board card goes green
7. Tap the other preschooler's card → the context switches
8. Tap a book with **no** session open → it just plays, exactly as it does today (the no-regression case)
9. **Mid-story, assignment mode:** tap a second book → on-screen "finish this one first", nothing queues (D5)
10. **Mid-story, browsing mode:** after the target is met, tap a second book → the existing queue behaviour, unchanged (D5)
11. **Movie playing, no session:** tap a card → brief refusal on screen, the movie keeps playing (D2)
12. **Ceremony renders before the TV powers off** — the D8 hazard. Watch the actual screen; a passing test is not enough here
13. **Walk away at the prompt:** ~2 min later the TV powers off on its own (D6)
14. **Tap during teardown:** the TV stays on and the session reopens (D7)
15. **An unregistered book tag in a session:** the screen says it doesn't know the book, and a phone push arrives (D9)

---

## Known gaps this plan does not close

- **A story finished on a lap** still cannot be credited except through plan 02's CLI. If that matters, it is a separate evidence path and a separate decision.
- **Two children listening together** credits only the child whose card opened the session. Multi-attribution was not part of the requirements and is not designed here.
- **A repeated book counts again.** Accepted trade-off (see the state machine doc): the daily target can be met by re-reading one short book. If that becomes a problem in the field, the fix is a `repeat` flag on the reading log row and a count that ignores repeats — a small change, deliberately not pre-built.
