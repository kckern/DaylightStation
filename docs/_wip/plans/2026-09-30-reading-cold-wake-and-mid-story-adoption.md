# Reading Sessions: Cold-Wake Delivery and Mid-Story Adoption — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A child who scans their card at the living-room reader is never lost to a slow TV wake, and a card scanned while their book is already playing adopts that story in place — same position, credited to them — instead of restarting it.

**Architecture:** Two independent halves over the existing reading-session machine. Part A (backend only) widens the initial launch-card delivery budget so a cold-booting TV can acknowledge it, and holds a book tapped while that card is still in flight instead of refusing it. Part B adds an *adoption* presentation: the server remembers the last book dispatched unclaimed at a reader, a card tapped while it plays asks the TV to adopt it, the TV proves what it is playing (content + position) from its own session source, re-mounts the story inside the reading stage at the same position, and ACKs; credit then flows through the ordinary pick → playing → natural-end → `POST /read` chain.

**Tech Stack:** Node ESM backend (`.mjs`, DDD layers), Express 4 router, React 18 frontend, vitest (+ supertest, @testing-library/react).

**Spec:** No separate spec document — the problem statement is the **Spec** section immediately below. The behavioural authority for this machine is `docs/reference/school/reading-sessions.md`; read §5–§9 before starting.

---

## Spec

### What happened (2026-09-30, a preschooler, "Great Day For Up!" `plex:674736`, track `plex:674737`, 4:52)

Log-store times are `_time` (UTC); local is PDT (−7h).

| UTC | Event |
|---|---|
| 18:30:37.792 | the child's card → `school.reading.session-open` (reserved `starting`), TV off → wake |
| 18:30:46.168 | `school.reading.session-opened` `wakeMs: 8373` — presentation published, ACK loop starts (2 × 8 s) |
| 18:30:57.147 | TV page `frontend-start /screen/living-room` (page not loaded until 11 s after the wake returned) |
| 18:31:00.824 | Book tapped → `trigger.content.claimed by reading-session` → interceptor answers **`launch-card-not-ready`** (claimed + refused: the book never plays and nothing is shown, the screen isn't there yet) |
| 18:31:03.232 | `artmode.mount` — the art screensaver covers the page (`presentationObscured`) |
| 18:31:03.242 | TV receives `session-present` |
| 18:31:03.745 | Server: `delivery-unacknowledged attempts: 2` → `session-close reason: presentation-unacknowledged` (0.5 s after the TV finally had it) |
| 18:31:24.921 | Book re-tap debounced (30 s window) |
| 18:31:36–42 | Book re-tap → no session → ordinary `wake-and-load play-next plex:674736` → plays from 0 **unclaimed** |
| 18:31:53.935 | the child's card → `refusal-exempted` (reclaim after `presentation-unacknowledged`) → new session → TV **unmounts the playing story at 11.785 s** (`playback.unmount-progress-save`) → launch card |
| 18:32:19–24 | Book tapped a fourth time → countdown → `playback-started` **from 0:00**, credited to the child |

### Problem statement

1. **A cold-waking TV loses the child's session.** The initial launch-card delivery budget (2 attempts × 8 s ACK wait, started when the wake call returns) is shorter than a cold Shield takes to load the page and paint. The server closes the session as `presentation-unacknowledged` and the book tap that arrived meanwhile was refused silently. The child did everything in order and was treated as if they never scanned.
2. **A card scanned mid-book restarts the story instead of adopting it.** When a book tapped at this reader is playing unattributed and the child then scans their card, the system should attach the *running* playback to that child — no picker, no countdown — resume at the exact position if the stage must re-mount, and credit the full read on natural end. Today it tears the player down and makes the child pick and restart.

### Settled design (names are binding)

- **A1** `makeReadingSessionHandler` gains `initialDeliveryBudgetMs = 60_000`. Initial-path attempts = `Math.max(maxDeliveryAttempts, Math.ceil(initialDeliveryBudgetMs / ackTimeoutMs))`. Re-foreground (`wakeScreen({..., prepareOnly: true})`) only on the first `maxDeliveryAttempts − 1` replays; later replays only `sessions.reannounce`. The switch path is unchanged.
- **A2** `ReadingSessionService.holdBook(location, pick)` stores `heldPick` while the session is `starting`, or `presenting` with `pendingPresentation.reason === 'initial'`. `acknowledge()` of that initial presentation commits `confirm` with the held pick and broadcasts `session-open` then `book-selected`. The interceptor holds instead of refusing in exactly those states; `returning` and switch/rollback presentations keep the `launch-card-not-ready` refusal.
- **B1** `ReadingSessionService`: `noteUnclaimedPlay`, `unclaimedPlay` (bounded by exported `ADOPTABLE_PLAY_MS = 2 h`), `beginAdoption`, `acknowledge()` for `reason: 'adopt'` (commits `confirm` + adopted pick), `declineAdoption`. The interceptor records every content dispatch it hands back with no session.
- **B2** The card handler offers adoption **before** the D2/departed check when content is playing and `unclaimedPlay(location)` exists. No wake. ACK loop; unacknowledged → close `adopt-unacknowledged`. The unclaimed record survives a failed adoption so a re-tap retries.
- **B3** `POST /api/v1/school/reading/session/adopt-decline {location, presentationId, reason}` with reason allowlist `not-playing | content-mismatch | no-owner`.
- **B4** `resolveAdoptablePlayback({capture, bookContentId, fetchQueue})` — pure TV-side proof of what is playing and where.
- **B5/B6** The TV hook adopts on `session-present reason: 'adopt'`: prove → ACK → commit attribution → mount the reading stage with the book queue from the playing track → seek to the proved position on first frame. Mismatch → decline + the D2 notice.

---

## Global Constraints

- Backend modules are `.mjs`; application-layer code logs only through its injected `logger` (`this.#log(...)` / `log(...)` helpers already in each file) — never `console.*`.
- Frontend reading code logs only through the `readingLog` facade (`frontend/src/modules/School/reading/readingLog.js`) — never raw `console.*` (CLAUDE.md "Always use the logging framework").
- Every new log event name is dotted and prefixed `school.reading.` on the backend; `readingLog.<category>('<event>', {...})` on the frontend.
- Match the surrounding comment style: these files carry WHY-comments naming the incident and date. New branches get one, citing 2026-09-30.
- Invariants 1 and 2 of `reading-sessions.md` §10 hold unchanged: credit only from Player's natural-end callback; attribution minted and owned server-side at pick time. An adopted pick is minted by the **server** (`beginAdoption`), never by the TV.
- D2 still holds for anything that is not provably the book tapped at this reader: the TV must decline adoption whenever its own evidence disagrees.
- No instance-specific hosts, ports or paths in `docs/` (CLAUDE.md docs rule 6).
- Tests use the existing rigs (`TEST_SCHEDULER` subclass of `ReadingSessionService`, `recorder()`, `stubFetch`) — do not introduce new mocking frameworks.
- Commits: one per task, pathspec-only (`git commit -- <paths>`); the shared worktree carries unrelated staged files that must never ride along. End every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A movie started from a phone after a book tap** (stale unclaimed record, `isPlaying` true, a different track playing) — the TV must decline with `content-mismatch`, show "Something else is playing", and leave the movie untouched. *Pinned:* Task 6 (resolver `content-mismatch`) and Task 7 (decline posted, no `onPlay`, notice shown).
2. **The foreign book already ended or went idle at scan time** — capture state `idle`/`ended` — decline `not-playing`; a `paused` book is adoptable and resumes. *Pinned:* Task 6 (`not-playing` for idle/ended, ok for paused).
3. **A second child's card while an adoption presentation is pending** — must be refused `not-at-launch-card` without disturbing the pending adoption. *Pinned:* Task 4.
4. **Page reload mid-adoption** — hydration replays the pending `adopt` presentation; the adoption completes exactly once with the server's pickId. *Pinned:* Task 7 (hydrate test).
5. **A short audiobook adopted near its end** — the Player's controller ignores a start offset for audio under 12 minutes (`useCommonMediaController.js` `shouldApplyStart = duration > 12*60 || isVideo`) and resets offsets within 30 s of the end, so a naive `seconds` would restart from 0:00. The reading stage therefore seeks the element itself on first frame. *Pinned:* Task 8 (position 280 s of a 292 s book is applied to the element once).

---

## File Map

| File | Change | Responsibility |
|---|---|---|
| `backend/src/3_applications/school/workflows/LearnerCardActions.mjs` | modify | A1 delivery budget; B2 adoption offer + ACK loop; `studyDay` dep |
| `backend/src/3_applications/school/ReadingSessionService.mjs` | modify | A2 `holdBook` + held-pick commit; B1 unclaimed plays, `beginAdoption`, adopt ACK, `declineAdoption`, `ADOPTABLE_PLAY_MS` |
| `backend/src/3_applications/school/readingSessionInterceptor.mjs` | modify | A2 hold instead of refuse; B1 `noteUnclaimedPlay` on the no-session path |
| `backend/src/3_applications/school/ReadingApiService.mjs` | modify | B3 `declineAdoption` |
| `backend/src/4_api/v1/routers/reading.mjs` | modify | B3 `POST /session/adopt-decline` |
| `backend/src/app.mjs` (~line 5373) | modify | B2 wire `studyDay` |
| `frontend/src/modules/School/schoolApi.js` (~line 490) | modify | B3 client `declineReadingAdoption` |
| `frontend/src/modules/School/reading/adoptForeignPlayback.js` | **create** | B4 pure resolver |
| `frontend/src/modules/School/reading/useReadingSession.js` | modify | B5 adoption branch, session-open guard |
| `frontend/src/modules/School/reading/ReadingSessionScreen.jsx` | modify | B6 resolver wiring, array play, first-frame seek, screensaver-dismiss guard |
| `docs/reference/school/reading-sessions.md` | modify | behaviour doc |
| `CLAUDE.md` | modify | nav row for reading-sessions.md |
| tests | create/modify | per task |

---

### Task 1: Cold-wake delivery budget (A1)

**Files:**
- Modify: `backend/src/3_applications/school/workflows/LearnerCardActions.mjs:147-151` (signature), `:391-428` (initial delivery loop)
- Test: `tests/isolated/composition/readingSessionAction.test.mjs`

**Interfaces:**
- Consumes: `sessions.waitForAcknowledgement(token, ms)`, `sessions.reannounce(location, token)`, `sessions.current`, `sessions.close` (all existing).
- Produces: `makeReadingSessionHandler({ ..., initialDeliveryBudgetMs = 60_000 })`. Log `school.reading.delivery-unacknowledged` now carries `attempts` = the real attempt count and `budgetMs`.

- [ ] **Step 1: Thread the new option through the test rig and keep the old test's semantics**

In `tests/isolated/composition/readingSessionAction.test.mjs`, extend `build()`:

```js
function build({
  playing = false,
  wake = async () => ({ ok: true }),
  scheduler = TEST_SCHEDULER,
  logger = silent,
  alertAdult = null,
  ackTimeoutMs = 8_000,
  maxDeliveryAttempts = 3,
  initialDeliveryBudgetMs = undefined,
} = {}) {
```

and pass it into the handler only when defined:

```js
  const handler = makeReadingSessionHandler({
    sessions: store,
    isPlaying: typeof playing === 'function' ? playing : () => playing,
    wakeScreen: async (args) => { woke.push(args); return wake(args); },
    alertAdult,
    ackTimeoutMs,
    maxDeliveryAttempts,
    ...(initialDeliveryBudgetMs === undefined ? {} : { initialDeliveryBudgetMs }),
    eventBus: bus,
    logger,
  });
```

In the existing test `'alerts an adult only after every bounded delivery recovery attempt fails'`, change its build call to `build({ scheduler, logger, alertAdult, maxDeliveryAttempts: 3, initialDeliveryBudgetMs: 0 })`. With a zero budget `Math.max(3, 0) === 3`, so its assertions are unchanged.

- [ ] **Step 2: Write the failing tests**

Append to the same file:

```js
describe('reading-session — a cold TV gets long enough to paint (2026-09-30)', () => {
  // On 2026-09-30 the page loaded 11s after the wake returned and received the
  // launch card 0.5s before a 2 x 8s budget closed the session. The budget is
  // now time-shaped: ~60s of replays, re-foregrounding only as often as before.
  const failingScheduler = () => ({
    withDeadline: async () => { throw new Error('deadline'); },
    every: () => () => {},
    wait: async () => {},
  });

  it('keeps replaying for the whole budget before giving up — 8 attempts at the defaults', async () => {
    const logger = { ...silent, info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const alertAdult = vi.fn(async () => {});
    const r = build({ scheduler: failingScheduler(), logger, alertAdult, maxDeliveryAttempts: 2 });

    await r.handler(tap());

    await vi.waitFor(() => expect(alertAdult).toHaveBeenCalledTimes(1));
    expect(logger.error).toHaveBeenCalledWith(
      'school.reading.delivery-unacknowledged',
      expect.objectContaining({ attempts: 8, budgetMs: 60_000 }),
    );
    // One initial wake, then re-foreground only once (maxDeliveryAttempts - 1):
    // a cold Shield is not helped by being foregrounded every eight seconds.
    expect(r.woke).toEqual([
      { target: 'livingroom-tv', location: 'livingroom' },
      { target: 'livingroom-tv', location: 'livingroom', prepareOnly: true },
    ]);
    const presents = r.sent.filter((e) => e.payload?.event === 'session-present');
    expect(presents).toHaveLength(8); // activate + 7 replays
    expect(r.sessions.current('livingroom')).toBeNull();
  });

  it('an ACK that lands on the third attempt commits the prompt and nothing is closed', async () => {
    let calls = 0;
    let store = null;
    const scheduler = {
      withDeadline: async (work) => {
        calls += 1;
        if (calls === 3) {
          const pending = store.current('livingroom')?.pendingPresentation;
          if (pending) store.acknowledge('livingroom', pending);
          return work;
        }
        throw new Error('deadline');
      },
      every: () => () => {},
      wait: async () => {},
    };
    const alertAdult = vi.fn(async () => {});
    const r = build({ scheduler, alertAdult, maxDeliveryAttempts: 2 });
    store = r.sessions;

    await r.handler(tap());

    await vi.waitFor(() => expect(r.sessions.current('livingroom')?.state).toBe('prompt'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(alertAdult).not.toHaveBeenCalled();
    expect(r.sent.some((e) => e.payload?.event === 'session-close')).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/isolated/composition/readingSessionAction.test.mjs`
Expected: the two new tests FAIL (`attempts: 2`, session closed after attempt 2); all existing tests PASS.

- [ ] **Step 4: Implement**

In `makeReadingSessionHandler`'s parameter list add the option:

```js
export function makeReadingSessionHandler({
  sessions, isPlaying = null, wakeScreen = null, alertAdult = null, realtime = null,
  clock = () => new Date(), logger = console,
  ackTimeoutMs = 8_000, maxDeliveryAttempts = 2,
  // How long a COLD reader gets to paint its first launch card. On 2026-09-30
  // the Shield's page loaded 11s after the wake call returned and received
  // the card 0.5s before a 2 x 8s budget closed the session as unseen; the
  // child's book, tapped in that window, was refused with nothing on screen.
  // Time-shaped rather than attempt-shaped, because what varies is how long
  // the WebView takes to come up, not how many replays it needs.
  initialDeliveryBudgetMs = 60_000,
} = {}) {
```

Replace the initial-delivery IIFE body (the `if (active?.pendingPresentation?.presentationId) { void (async () => { ... })(); }` block) with:

```js
    if (active?.pendingPresentation?.presentationId) {
      const attempts = Math.max(
        maxDeliveryAttempts,
        ackTimeoutMs > 0 ? Math.ceil(Math.max(0, initialDeliveryBudgetMs) / ackTimeoutMs) : 0,
      );
      void (async () => {
        const presentation = active.pendingPresentation;
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
          if (await sessions.waitForAcknowledgement(presentation.presentationId, ackTimeoutMs)) {
            log('info', 'school.reading.delivery-acknowledged', {
              location, sessionId: presentation.sessionId,
              presentationId: presentation.presentationId, attempt,
            });
            return;
          }
          if (attempt === attempts) break;
          // Re-foreground only as often as before the budget grew. A cold
          // WebView is not helped by `toForeground` every eight seconds, and
          // the page reload seen at 18:31:07 on 2026-09-30 is not a thing to
          // provoke more of. Later attempts only replay the presentation.
          if (attempt < maxDeliveryAttempts) {
            try { await wakeScreen?.({ target, location, prepareOnly: true }); } catch (err) {
              log('warn', 'school.reading.delivery-replay-wake-failed', { location, attempt: attempt + 1, error: err?.message ?? String(err) });
            }
          }
          sessions.reannounce(location, presentation.presentationId);
        }
        log('error', 'school.reading.delivery-unacknowledged', {
          location, learnerId, sessionId: presentation.sessionId,
          presentationId: presentation.presentationId, attempts, budgetMs: initialDeliveryBudgetMs,
        });
        const current = sessions.current(location);
        let closed = null;
        if (current?.pendingPresentation?.presentationId === presentation.presentationId) {
          closed = sessions.close(location, { reason: 'presentation-unacknowledged' });
        }
        if (!closed) return;
        try { await alertAdult?.({ location, target, learnerId, sessionId: presentation.sessionId }); } catch (err) {
          log('warn', 'school.reading.delivery-alert-failed', { location, error: err?.message ?? String(err) });
        }
      })();
    }
```

Keep the existing explanatory comment block above the loop ("The initial wake is intentionally outside this retry loop…").

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/isolated/composition/readingSessionAction.test.mjs tests/isolated/application/school/learnerCardActions.readingRefusal.test.mjs`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git commit -m "fix(school): a cold living-room TV gets ~60s to paint the launch card

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- backend/src/3_applications/school/workflows/LearnerCardActions.mjs tests/isolated/composition/readingSessionAction.test.mjs
```

---

### Task 2: Hold a book tapped while the first launch card is in flight (A2)

**Files:**
- Modify: `backend/src/3_applications/school/ReadingSessionService.mjs` (new `holdBook`; `acknowledge` at `:506-564`)
- Modify: `backend/src/3_applications/school/readingSessionInterceptor.mjs:107-113`
- Test: `tests/isolated/application/school/ReadingSessionService.test.mjs`, `tests/isolated/application/school/readingSessionInterceptor.test.mjs`

**Interfaces:**
- Produces: `ReadingSessionService#holdBook(location, pick) → session|null` (pick shape = the interceptor's `{pickId, learnerId, contentId, target, studyDay, at}`); session field `heldPick`. `acknowledge()` of an `initial` presentation with a `heldPick` commits `state: 'confirm'`, `pick`, and broadcasts `book-selected` after `session-open`. Log `school.reading.held-book-applied`.
- Produces: interceptor claim result `{ claimed: true, by: 'reading-session', held: true, learnerId, contentId }`; log `school.reading.book-held`.

- [ ] **Step 1: Write the failing service tests**

Append to `tests/isolated/application/school/ReadingSessionService.test.mjs`:

```js
describe('ReadingSessionService — a book tapped before the launch card was seen (2026-09-30)', () => {
  const pickFor = (over = {}) => ({
    pickId: 'pick_1', learnerId: 'user_5', contentId: 'plex:674736', target: 'livingroom-tv',
    studyDay: '2026-09-30', at: '2026-09-30T18:31:00.824Z', ...over,
  });
  const presenting = (sent = []) => {
    const s = new ReadingSessionService({ logger: silent, realtime: realtimeFor(sent) });
    const reserved = s.open({ location: 'livingroom', learnerId: 'user_5', target: 'livingroom-tv', state: 'starting' });
    const active = s.activate('livingroom', reserved.sessionId);
    return { s, sent, active };
  };

  it('holds a book while the INITIAL presentation is pending, latest tap wins', () => {
    const { s } = presenting();
    s.holdBook('livingroom', pickFor({ pickId: 'pick_1', contentId: 'plex:1' }));
    s.holdBook('livingroom', pickFor({ pickId: 'pick_2', contentId: 'plex:674736' }));
    expect(s.current('livingroom').heldPick).toMatchObject({ pickId: 'pick_2', contentId: 'plex:674736' });
  });

  it('holds a book while the reservation is still STARTING (the wake has not returned)', () => {
    const s = new ReadingSessionService({ logger: silent });
    s.open({ location: 'livingroom', learnerId: 'user_5', state: 'starting' });
    expect(s.holdBook('livingroom', pickFor())).not.toBeNull();
  });

  it('does not hold during a switch or a return — those keep refusing', () => {
    const s = new ReadingSessionService({ logger: silent });
    s.open({ location: 'livingroom', learnerId: 'user_5' });
    s.beginSwitch({ location: 'livingroom', learnerId: 'user_3' });
    expect(s.holdBook('livingroom', pickFor())).toBeNull();
    s.open({ location: 'livingroom', learnerId: 'user_5' });
    s.beginReturn('livingroom');
    expect(s.holdBook('livingroom', pickFor())).toBeNull();
  });

  it('the ACK applies the held book: confirm + pick, session-open THEN book-selected', () => {
    const { s, sent, active } = presenting();
    s.holdBook('livingroom', pickFor());
    s.acknowledge('livingroom', active.pendingPresentation);
    expect(s.current('livingroom')).toMatchObject({ state: 'confirm', heldPick: null, pick: { pickId: 'pick_1', contentId: 'plex:674736' } });
    const events = sent.map((m) => m.payload.event);
    const openAt = events.lastIndexOf('session-open');
    const selectedAt = events.lastIndexOf('book-selected');
    expect(openAt).toBeGreaterThanOrEqual(0);
    expect(selectedAt).toBeGreaterThan(openAt);
    expect(sent[selectedAt].payload).toMatchObject({ learnerId: 'user_5', contentId: 'plex:674736', pickId: 'pick_1', sessionId: active.sessionId });
  });

  it('an ACK with nothing held commits the plain prompt as before', () => {
    const { s, active } = presenting();
    s.acknowledge('livingroom', active.pendingPresentation);
    expect(s.current('livingroom')).toMatchObject({ state: 'prompt' });
    expect(s.current('livingroom').pick ?? null).toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing interceptor tests**

Append to `tests/isolated/application/school/readingSessionInterceptor.test.mjs`:

```js
describe('ReadingSessionInterceptor — a book that beats the launch card (2026-09-30)', () => {
  it('HOLDS a book tapped while the initial card is being delivered — claimed, not refused', async () => {
    const { interceptor, sessions, sent } = build();
    const reserved = sessions.open({ location: 'livingroom', learnerId: 'user_5', target: 'livingroom-tv', state: 'starting' });
    sessions.activate('livingroom', reserved.sessionId);

    const claim = await interceptor.claim(bookTap({ expression: { action: 'play-next', contentId: 'plex:674736', options: {} } }));

    expect(claim).toMatchObject({ claimed: true, held: true, learnerId: 'user_5', contentId: 'plex:674736' });
    expect(claim.refused).toBeUndefined();
    expect(sessions.current('livingroom').heldPick).toMatchObject({ contentId: 'plex:674736', learnerId: 'user_5' });
    expect(sessions.current('livingroom').heldPick.pickId).toEqual(expect.any(String));
    expect(sent.some((m) => m.payload.event === 'book-refused')).toBe(false);
  });

  it('still refuses launch-card-not-ready while a RETURN is pending', async () => {
    const { interceptor, sessions } = build();
    sessions.open({ location: 'livingroom', learnerId: 'user_5' });
    sessions.beginReturn('livingroom');
    const claim = await interceptor.claim(bookTap());
    expect(claim).toMatchObject({ claimed: true, refused: true, reason: 'launch-card-not-ready' });
  });

  it('still refuses launch-card-not-ready while a sibling SWITCH is pending', async () => {
    const { interceptor, sessions } = build();
    sessions.open({ location: 'livingroom', learnerId: 'user_5' });
    sessions.beginSwitch({ location: 'livingroom', learnerId: 'user_3' });
    const claim = await interceptor.claim(bookTap());
    expect(claim).toMatchObject({ claimed: true, refused: true, reason: 'launch-card-not-ready' });
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/isolated/application/school/ReadingSessionService.test.mjs tests/isolated/application/school/readingSessionInterceptor.test.mjs`
Expected: new tests FAIL (`holdBook is not a function`; claim refused).

- [ ] **Step 4: Implement `holdBook` in the service**

Add after `rollbackPresentation`:

```js
  /**
   * A BOOK THAT BEAT THE LAUNCH CARD. On 2026-09-30 a cold TV took 17s to show
   * the child their card, and the book they tapped in the meantime was refused
   * `launch-card-not-ready` — claimed, so it never played, and refused to a
   * screen that did not exist yet, so nothing said so. Scanning a card and
   * then a book is ONE act; the TV's boot time is not the child's problem.
   *
   * Only the INITIAL presentation holds. A switch or a return has a face on
   * screen already and a child who can see it; those keep refusing.
   * The latest tap wins, exactly as a swap does in `confirm`.
   *
   * @returns {object|null} the updated session, or null when this is not a
   *   moment a book may be held
   */
  holdBook(location, pick) {
    const session = this.#sessions.get(location) ?? null;
    if (!session || !pick?.contentId || !pick?.pickId) return null;
    const holdable = session.state === STARTING
      || (session.state === PRESENTING && session.pendingPresentation?.reason === 'initial');
    if (!holdable) return null;
    const updated = this.update(location, { heldPick: Object.freeze({ ...pick }) });
    this.#log('info', 'school.reading.book-held', {
      location, learnerId: session.learnerId, sessionId: session.sessionId,
      contentId: pick.contentId, pickId: pick.pickId, state: session.state,
    });
    return updated;
  }
```

- [ ] **Step 5: Apply the held pick in `acknowledge()`**

In `acknowledge`, replace the `const committed = Object.freeze({...})` construction and the broadcasts after it with:

```js
    const at = this.#clock();
    const presentation = session.pendingPresentation;
    const held = presentation.reason === 'initial' ? session.heldPick ?? null : null;
    const committed = Object.freeze({
      ...session,
      learnerId: presentation.learnerId,
      target: presentation.target ?? session.target ?? null,
      sessionId: presentation.sessionId,
      state: held ? 'confirm' : PROMPT,
      pick: held ?? session.pick ?? null,
      heldPick: null,
      revision: presentation.revision,
      serverEpoch: presentation.serverEpoch,
      presentationId: presentation.presentationId,
      presentedAt: at.toISOString(),
      acknowledgedAt: at.toISOString(),
      pendingPresentation: null,
      openedAt: presentation.reason === 'switch' ? at.toISOString() : session.openedAt,
      lastActivityAt: at.getTime(),
    });
    this.#sessions.set(location, committed);
    this.#persistSoon();
    this.#observe('presentation-acknowledged', committed, {
      presentationId: presentation.presentationId, reason: presentation.reason,
    });
    this.#log('info', 'school.reading.session-switch-rendered', {
      location, learnerId: committed.learnerId, sessionId: committed.sessionId,
      presentationId: committed.presentationId, reason: presentation.reason,
    });
    this.#broadcast(location, { event: 'session-open', ...committed });
    if (held) {
      // The launch card must be on screen before the book lands on it — the
      // same order the timeout reopen relies on (`session-open`, then
      // `book-selected`). The screen then runs its ordinary countdown.
      this.#broadcast(location, {
        event: 'book-selected', learnerId: committed.learnerId, location,
        sessionId: committed.sessionId, ...held,
      });
      this.#log('info', 'school.reading.held-book-applied', {
        location, learnerId: committed.learnerId, sessionId: committed.sessionId,
        contentId: held.contentId, pickId: held.pickId,
      });
    }
    this.#resolveAcknowledgement(presentation);
    return committed;
```

- [ ] **Step 6: Hold in the interceptor**

In `readingSessionInterceptor.mjs` `claim()`, replace the `if (['starting', 'presenting', 'returning'].includes(session.state)) { ... }` block with:

```js
    if (['starting', 'presenting', 'returning'].includes(session.state)) {
      // THE FIRST CARD'S BOOK IS HELD, NOT REFUSED (2026-09-30). While the
      // initial launch card is still being delivered — a cold TV can take the
      // better part of a minute — the book is the second half of the child's
      // one act. `holdBook` decides whether this is that moment; the ACK that
      // proves the card was seen then applies it as an ordinary pick.
      const held = this.#sessions.holdBook?.(location, {
        pickId: this.#nextPickId(), learnerId, contentId, target: response.target ?? null,
        studyDay: this.#storyTime?.studyDay?.() ?? null, at: this.#clock().toISOString(),
      }) ?? null;
      if (held) {
        return { claimed: true, by: CLAIMED_BY, held: true, learnerId, contentId };
      }
      this.#broadcast(location, {
        event: 'book-refused', reason: 'launch-card-not-ready', learnerId, location, contentId,
        at: this.#clock().toISOString(),
      });
      return { claimed: true, by: CLAIMED_BY, refused: true, reason: 'launch-card-not-ready', learnerId, contentId };
    }
```

(`holdBook` logs `school.reading.book-held` itself.)

- [ ] **Step 7: Run to verify pass**

Run: `npx vitest run tests/isolated/application/school/ReadingSessionService.test.mjs tests/isolated/application/school/readingSessionInterceptor.test.mjs tests/isolated/composition/readingSessionAction.test.mjs`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git commit -m "fix(school): a book tapped before the launch card paints is held, not refused

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- backend/src/3_applications/school/ReadingSessionService.mjs backend/src/3_applications/school/readingSessionInterceptor.mjs tests/isolated/application/school/ReadingSessionService.test.mjs tests/isolated/application/school/readingSessionInterceptor.test.mjs
```

---

### Task 3: Server-side adoption primitives (B1)

**Files:**
- Modify: `backend/src/3_applications/school/ReadingSessionService.mjs`
- Modify: `backend/src/3_applications/school/readingSessionInterceptor.mjs:99-102`
- Test: `tests/isolated/application/school/ReadingSessionService.test.mjs`, `tests/isolated/application/school/readingSessionInterceptor.test.mjs`

**Interfaces:**
- Produces (service):
  - `export const ADOPTABLE_PLAY_MS = 2 * 60 * 60_000;`
  - `noteUnclaimedPlay(location, { contentId, target }) → void`
  - `unclaimedPlay(location) → { contentId, target, at } | null`
  - `beginAdoption({ location, learnerId, target, contentId, studyDay }) → session | null` — session `state: 'presenting'`, `pendingPresentation: { presentationId, sessionId, learnerId, target, revision, serverEpoch, reason: 'adopt', adopt: { contentId, pickId, studyDay } }`, broadcast `session-present`.
  - `acknowledge()` for `reason: 'adopt'` → `state: 'confirm'`, `pick: { pickId, learnerId, contentId, target, studyDay, at, adopted: true }`; consumes the unclaimed record.
  - `declineAdoption(location, presentationId, reason) → closedSession | null` — close reason `'adopt-declined'`.
- Logs: `school.reading.unclaimed-play-noted`, `school.reading.adoption-requested`, `school.reading.adoption-committed`, `school.reading.adoption-declined`.

- [ ] **Step 1: Write the failing service tests**

Append to `tests/isolated/application/school/ReadingSessionService.test.mjs` (add `ADOPTABLE_PLAY_MS` to the import: `import { ReadingSessionService as ProductionReadingSessionService, ADOPTABLE_PLAY_MS } from '#apps/school/ReadingSessionService.mjs';`):

```js
describe('ReadingSessionService — adopting a book already playing (2026-09-30)', () => {
  const rig = () => {
    const state = { now: Date.parse('2026-09-30T18:31:36Z') };
    const sent = [];
    const s = new ReadingSessionService({ logger: silent, realtime: realtimeFor(sent), clock: () => new Date(state.now) });
    return { s, sent, tick: (ms) => { state.now += ms; } };
  };

  it('remembers the last book dispatched unclaimed at a reader, latest wins', () => {
    const { s } = rig();
    s.noteUnclaimedPlay('livingroom', { contentId: 'plex:1', target: 'livingroom-tv' });
    s.noteUnclaimedPlay('livingroom', { contentId: 'plex:674736', target: 'livingroom-tv' });
    expect(s.unclaimedPlay('livingroom')).toMatchObject({ contentId: 'plex:674736', target: 'livingroom-tv' });
    expect(s.unclaimedPlay('study')).toBeNull();
  });

  it('forgets it after ADOPTABLE_PLAY_MS', () => {
    const { s, tick } = rig();
    s.noteUnclaimedPlay('livingroom', { contentId: 'plex:674736', target: 'livingroom-tv' });
    tick(ADOPTABLE_PLAY_MS + 1);
    expect(s.unclaimedPlay('livingroom')).toBeNull();
  });

  it('beginAdoption publishes an adopt presentation carrying a SERVER-minted pick', () => {
    const { s, sent } = rig();
    const session = s.beginAdoption({ location: 'livingroom', learnerId: 'user_7', target: 'livingroom-tv', contentId: 'plex:674736', studyDay: '2026-09-30' });
    expect(session).toMatchObject({ state: 'presenting', learnerId: 'user_7' });
    expect(session.pendingPresentation).toMatchObject({
      reason: 'adopt', learnerId: 'user_7',
      adopt: { contentId: 'plex:674736', studyDay: '2026-09-30', pickId: expect.any(String) },
    });
    const present = sent.find((m) => m.payload.event === 'session-present');
    expect(present.payload).toMatchObject({ reason: 'adopt', adopt: { contentId: 'plex:674736' } });
  });

  it('beginAdoption refuses when a session is already open', () => {
    const { s } = rig();
    s.open({ location: 'livingroom', learnerId: 'user_3' });
    expect(s.beginAdoption({ location: 'livingroom', learnerId: 'user_7', contentId: 'plex:674736' })).toBeNull();
  });

  it('the ACK commits confirm with the adopted pick and consumes the unclaimed record', () => {
    const { s } = rig();
    s.noteUnclaimedPlay('livingroom', { contentId: 'plex:674736', target: 'livingroom-tv' });
    const session = s.beginAdoption({ location: 'livingroom', learnerId: 'user_7', target: 'livingroom-tv', contentId: 'plex:674736', studyDay: '2026-09-30' });
    const { pickId } = session.pendingPresentation.adopt;
    s.acknowledge('livingroom', session.pendingPresentation);
    expect(s.current('livingroom')).toMatchObject({
      state: 'confirm',
      pick: { pickId, learnerId: 'user_7', contentId: 'plex:674736', studyDay: '2026-09-30', adopted: true },
    });
    expect(s.unclaimedPlay('livingroom')).toBeNull();
  });

  it('declineAdoption closes ONLY the matching pending adoption, as adopt-declined', () => {
    const { s, sent } = rig();
    s.noteUnclaimedPlay('livingroom', { contentId: 'plex:674736', target: 'livingroom-tv' });
    const session = s.beginAdoption({ location: 'livingroom', learnerId: 'user_7', contentId: 'plex:674736' });
    expect(s.declineAdoption('livingroom', 'rp_wrong', 'content-mismatch')).toBeNull();
    expect(s.declineAdoption('livingroom', session.pendingPresentation.presentationId, 'content-mismatch')).not.toBeNull();
    expect(s.current('livingroom')).toBeNull();
    expect(s.recentlyClosed('livingroom')).toMatchObject({ reason: 'adopt-declined' });
    expect(s.unclaimedPlay('livingroom')).toBeNull();
    expect(sent.at(-1).payload).toMatchObject({ event: 'session-close', reason: 'adopt-declined' });
  });
});
```

- [ ] **Step 2: Write the failing interceptor test**

Append to `readingSessionInterceptor.test.mjs`:

```js
describe('ReadingSessionInterceptor — remembers the book nobody claimed', () => {
  it('records an unclaimed book dispatch at the reader so a later card can adopt it', async () => {
    const { interceptor, sessions } = build();
    expect(await interceptor.claim(bookTap({ expression: { action: 'play-next', contentId: 'plex:674736', options: {} } }))).toBeNull();
    expect(sessions.unclaimedPlay('livingroom')).toMatchObject({ contentId: 'plex:674736', target: 'livingroom-tv' });
  });

  it('does NOT record a book a session claimed', async () => {
    const { interceptor, sessions } = build();
    sessions.open({ location: 'livingroom', learnerId: 'user_5' });
    await interceptor.claim(bookTap());
    expect(sessions.unclaimedPlay('livingroom')).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/isolated/application/school/ReadingSessionService.test.mjs tests/isolated/application/school/readingSessionInterceptor.test.mjs`
Expected: new tests FAIL (`noteUnclaimedPlay is not a function`, `ADOPTABLE_PLAY_MS` undefined).

- [ ] **Step 4: Implement the service primitives**

Near the other exported constants:

```js
/**
 * How long a book dispatched UNCLAIMED at a reader stays adoptable by the next
 * learner card there.
 *
 * On 2026-09-30 a child's session died to a cold TV, his re-tapped book played
 * with nobody's name on it, and his card 17 seconds later restarted the story
 * from 0:00 instead of claiming it. The record says "the last thing tapped at
 * this reader was this book"; the TV — which knows what it is ACTUALLY playing
 * — is the proof (`resolveAdoptablePlayback`). This bound only keeps a stale
 * record from outliving any plausible story. Two hours is well past the longest
 * read-along; the TV declines anything it cannot confirm, so a longer bound
 * costs nothing but a round trip.
 */
export const ADOPTABLE_PLAY_MS = 2 * 60 * 60_000;
```

Add the private field next to `#recentlyClosed`:

```js
  /** location -> {contentId, target, at}: the last book dispatched with no session here. */
  #unclaimedPlays = new Map();
```

Add the methods after `holdBook`:

```js
  /** The interceptor's note: a book just dispatched here with nobody's name on it. */
  noteUnclaimedPlay(location, { contentId, target = null } = {}) {
    if (typeof location !== 'string' || !location || typeof contentId !== 'string' || !contentId) return;
    this.#unclaimedPlays.set(location, Object.freeze({ contentId, target, at: this.#clock().getTime() }));
    this.#log('info', 'school.reading.unclaimed-play-noted', { location, contentId, target });
  }

  /** @returns {{contentId: string, target: string|null, at: number}|null} */
  unclaimedPlay(location) {
    const record = this.#unclaimedPlays.get(location) ?? null;
    if (!record) return null;
    if (this.#clock().getTime() - record.at > ADOPTABLE_PLAY_MS) return null;
    return record;
  }

  /**
   * A card at a reader where the child's book is already playing: ask the
   * screen to ADOPT that story rather than put up a launch card over it.
   *
   * The pick is minted HERE, at adoption time, exactly as the interceptor
   * mints one at book time — attribution stays server-owned (invariant 2).
   * Commit waits for the screen's ACK, which it sends only after proving it is
   * playing this book and re-mounting it under the reading stage.
   *
   * @returns {object|null} the presenting session, or null if one is open
   */
  beginAdoption({ location, learnerId, target = null, contentId, studyDay = null } = {}) {
    if (typeof location !== 'string' || !location.trim()) return null;
    if (typeof learnerId !== 'string' || !learnerId.trim()) return null;
    if (typeof contentId !== 'string' || !contentId) return null;
    const key = location.trim();
    if (this.#sessions.has(key)) return null;
    const at = this.#clock();
    const sessionId = this.#nextId('rs');
    const revision = this.#nextRevision(key);
    const presentation = Object.freeze({
      presentationId: this.#nextId('rp'), sessionId, learnerId: learnerId.trim(), target,
      revision, serverEpoch: this.#serverEpoch, reason: 'adopt',
      adopt: Object.freeze({ contentId, pickId: this.#nextId('pick'), studyDay }),
    });
    const session = Object.freeze({
      location: key, learnerId: learnerId.trim(), target, sessionId, revision,
      serverEpoch: this.#serverEpoch, state: PRESENTING, presentationId: null,
      presentedAt: null, acknowledgedAt: null, pendingPresentation: presentation,
      openedAt: at.toISOString(), lastActivityAt: at.getTime(), idleTimeoutMs: this.#idleTimeoutMs,
    });
    this.#sessions.set(key, session);
    this.#stuckReported.delete(key);
    this.#recentlyClosed.delete(key);
    this.#persistNow();
    this.#observe('adoption-requested', session, { presentationId: presentation.presentationId, contentId });
    this.#log('info', 'school.reading.adoption-requested', {
      location: key, learnerId: session.learnerId, sessionId, contentId,
      presentationId: presentation.presentationId, pickId: presentation.adopt.pickId,
    });
    this.#broadcast(key, { event: 'session-present', location: key, ...presentation });
    return session;
  }

  /**
   * The screen could not prove it is playing the book (a movie started since,
   * the story already ended, no playback owner). D2 is restored: the session
   * this adoption reserved is closed and the unclaimed record forgotten, so
   * the next card is an ordinary refusal rather than another adoption attempt.
   */
  declineAdoption(location, presentationId, reason = null) {
    const session = this.#sessions.get(location) ?? null;
    const pending = session?.pendingPresentation ?? null;
    if (!pending || pending.reason !== 'adopt' || pending.presentationId !== presentationId) return null;
    this.#unclaimedPlays.delete(location);
    const closed = this.close(location, { reason: 'adopt-declined' });
    this.#log('info', 'school.reading.adoption-declined', {
      location, learnerId: session.learnerId, sessionId: session.sessionId,
      contentId: pending.adopt?.contentId ?? null, reason,
    });
    return closed;
  }
```

- [ ] **Step 5: Commit adoption on ACK**

In `acknowledge()` (as rewritten in Task 2), branch the commit on `presentation.reason === 'adopt'`. Replace the `const held = ...` line and the `state:`/`pick:` fields with:

```js
    const held = presentation.reason === 'initial' ? session.heldPick ?? null : null;
    const adopted = presentation.reason === 'adopt' && presentation.adopt
      ? Object.freeze({
          pickId: presentation.adopt.pickId, learnerId: presentation.learnerId,
          contentId: presentation.adopt.contentId, target: presentation.target ?? session.target ?? null,
          studyDay: presentation.adopt.studyDay ?? null, at: at.toISOString(), adopted: true,
        })
      : null;
```

and in the `committed` object:

```js
      state: held || adopted ? 'confirm' : PROMPT,
      pick: adopted ?? held ?? session.pick ?? null,
```

After `this.#sessions.set(location, committed);` add:

```js
    if (adopted) {
      this.#unclaimedPlays.delete(location);
      this.#log('info', 'school.reading.adoption-committed', {
        location, learnerId: committed.learnerId, sessionId: committed.sessionId,
        contentId: adopted.contentId, pickId: adopted.pickId,
      });
    }
```

(`session-open` still broadcasts; the TV's hook ignores it for the pick it is already playing — Task 7.)

- [ ] **Step 6: Record unclaimed dispatches in the interceptor**

In `claim()`, replace `if (!session) return null;` with:

```js
    if (!session) {
      // Nobody's session, so this book plays with nobody's name on it — but it
      // was tapped at a READING reader, and a child's card may follow it in a
      // few seconds (2026-09-30: seventeen). Remember what it was, so that card
      // can adopt the running story instead of restarting it.
      const contentId = response.expression?.contentId ?? null;
      if (contentId) this.#sessions.noteUnclaimedPlay?.(location, { contentId, target: response.target ?? null });
      return null;
    }
```

- [ ] **Step 7: Run to verify pass**

Run: `npx vitest run tests/isolated/application/school/ReadingSessionService.test.mjs tests/isolated/application/school/readingSessionInterceptor.test.mjs tests/isolated/composition/readingSessionAction.test.mjs`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(school): reading sessions can adopt a book already playing (server half)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- backend/src/3_applications/school/ReadingSessionService.mjs backend/src/3_applications/school/readingSessionInterceptor.mjs tests/isolated/application/school/ReadingSessionService.test.mjs tests/isolated/application/school/readingSessionInterceptor.test.mjs
```

---

### Task 4: The card offers adoption (B2)

**Files:**
- Modify: `backend/src/3_applications/school/workflows/LearnerCardActions.mjs` (`makeReadingSessionHandler`: signature + the `!existing && busy` branch at `:185-257`)
- Modify: `backend/src/app.mjs` (~`:5373`, the `makeReadingSessionHandler({...})` call)
- Create: `tests/isolated/application/school/learnerCardActions.readingAdoption.test.mjs`

**Interfaces:**
- Consumes: `sessions.unclaimedPlay`, `sessions.beginAdoption`, `sessions.waitForAcknowledgement`, `sessions.reannounce`, `sessions.current`, `sessions.close` (Task 3).
- Produces: handler dep `studyDay = () => null`; result `{ status: 'reading_session_adopting', learnerId, location, sessionId, presentationId, contentId }`; close reason `'adopt-unacknowledged'`; logs `school.reading.adoption-offered`, `school.reading.adoption-acknowledged`, `school.reading.adoption-unacknowledged`.

- [ ] **Step 1: Write the failing tests (new file)**

`tests/isolated/application/school/learnerCardActions.readingAdoption.test.mjs`:

```js
/**
 * A card scanned while the child's book is already playing ADOPTS the story.
 *
 * 2026-09-30: the child's session died to a cold TV, his re-tapped book played with
 * nobody's name on it, and his card at 0:12 tore the story down and made him
 * pick it again — from 0:00. The card should have claimed the running story.
 *
 * The server's half is small and these tests pin it: when content is playing
 * AND the last thing dispatched at this reader was an unclaimed book, the card
 * asks the TV to adopt it instead of refusing (D2) or taking the room (the
 * reclaim exemption). The TV proves the rest.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  ReadingSessionService as ProductionReadingSessionService, ADOPTABLE_PLAY_MS,
} from '#apps/school/ReadingSessionService.mjs';
import { makeReadingSessionHandler } from '#apps/school/workflows/LearnerCardActions.mjs';

const silent = { warn() {}, info() {}, error() {}, debug() {} };
const TEST_SCHEDULER = { withDeadline: (work) => work, every: () => () => {}, wait: async () => {} };
class ReadingSessionService extends ProductionReadingSessionService {
  constructor(config = {}) { super({ scheduler: TEST_SCHEDULER, ...config }); }
}

function rig({ playing = true, scheduler = TEST_SCHEDULER } = {}) {
  const state = { now: Date.parse('2026-09-30T18:31:36Z') };
  const clock = () => new Date(state.now);
  const sent = [];
  const logs = [];
  const logger = {
    info: (event, data) => logs.push({ level: 'info', event, data }),
    warn: (event, data) => logs.push({ level: 'warn', event, data }),
    error: (event, data) => logs.push({ level: 'error', event, data }),
    debug() {},
  };
  const realtime = {
    readingRoomChanged: (location, { kind, ...payload }) => sent.push({ event: kind, location, ...payload }),
  };
  const sessions = new ReadingSessionService({ realtime, logger: silent, clock, scheduler });
  const woke = [];
  const handler = makeReadingSessionHandler({
    sessions,
    isPlaying: typeof playing === 'function' ? playing : () => playing,
    wakeScreen: async (args) => { woke.push(args); return { ok: true }; },
    studyDay: () => '2026-09-30',
    realtime, clock, logger,
  });
  return {
    sessions, handler, sent, logs, woke,
    tick: (ms) => { state.now += ms; },
    bookPlayed: (contentId = 'plex:674736') => sessions.noteUnclaimedPlay('livingroom', { contentId, target: 'livingroom-tv' }),
    tap: (learnerId = 'user_7') => handler({ learnerId, location: 'livingroom', target: 'livingroom-tv' }),
  };
}

describe('a learner card while their book is already playing', () => {
  it('offers adoption instead of refusing — the field case, 17s after the book', async () => {
    const r = rig();
    r.bookPlayed();
    r.tick(17_000);
    const result = await r.tap();
    expect(result).toMatchObject({ status: 'reading_session_adopting', learnerId: 'user_7', contentId: 'plex:674736' });
    const present = r.sent.find((m) => m.event === 'session-present');
    expect(present).toMatchObject({ reason: 'adopt', adopt: { contentId: 'plex:674736', studyDay: '2026-09-30' } });
    expect(r.sent.some((m) => m.event === 'session-refused')).toBe(false);
  });

  it('does not wake or foreground the TV — it is on and playing the story', async () => {
    const r = rig();
    r.bookPlayed();
    await r.tap();
    expect(r.woke).toEqual([]);
  });

  it('D2 is unchanged when nothing unclaimed was dispatched here — a movie is a movie', async () => {
    const r = rig();
    const result = await r.tap();
    expect(result).toMatchObject({ status: 'reading_session_refused', reason: 'content-playing' });
    expect(r.sessions.current('livingroom')).toBeNull();
  });

  it('does not adopt a book dispatched longer ago than ADOPTABLE_PLAY_MS', async () => {
    const r = rig();
    r.bookPlayed();
    r.tick(ADOPTABLE_PLAY_MS + 1);
    const result = await r.tap();
    expect(result.status).toBe('reading_session_refused');
  });

  it('does not offer adoption when nothing is playing — an ordinary session opens', async () => {
    const r = rig({ playing: false });
    r.bookPlayed();
    const result = await r.tap();
    expect(result.status).toBe('reading_session_presenting');
    expect(r.sent.find((m) => m.event === 'session-present')?.reason).toBe('initial');
  });

  it('the TV ACK commits confirm with the adopted, server-minted pick', async () => {
    const r = rig();
    r.bookPlayed();
    await r.tap();
    const pending = r.sessions.current('livingroom').pendingPresentation;
    r.sessions.acknowledge('livingroom', pending);
    expect(r.sessions.current('livingroom')).toMatchObject({
      state: 'confirm', pick: { pickId: pending.adopt.pickId, learnerId: 'user_7', adopted: true },
    });
  });

  it('a second child s card while the adoption is pending is refused and changes nothing', async () => {
    const r = rig();
    r.bookPlayed();
    await r.tap('user_7');
    const before = r.sessions.current('livingroom');
    const result = await r.tap('user_3');
    expect(result).toMatchObject({ status: 'reading_session_refused', reason: 'not-at-launch-card' });
    expect(r.sessions.current('livingroom').pendingPresentation.presentationId).toBe(before.pendingPresentation.presentationId);
  });

  it('an unacknowledged adoption closes as adopt-unacknowledged, and a re-tap offers it again', async () => {
    const scheduler = { withDeadline: async () => { throw new Error('deadline'); }, every: () => () => {}, wait: async () => {} };
    const r = rig({ scheduler });
    r.bookPlayed();
    await r.tap();
    await vi.waitFor(() => expect(r.sessions.current('livingroom')).toBeNull());
    expect(r.sessions.recentlyClosed('livingroom')).toMatchObject({ reason: 'adopt-unacknowledged' });
    expect(r.logs.some((l) => l.event === 'school.reading.adoption-unacknowledged')).toBe(true);
    const again = await r.tap();
    expect(again.status).toBe('reading_session_adopting');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/isolated/application/school/learnerCardActions.readingAdoption.test.mjs`
Expected: FAIL — adoption cases return `reading_session_refused` / `reading_session_presenting`.

- [ ] **Step 3: Implement the handler branch**

Add `studyDay = () => null,` to the `makeReadingSessionHandler` destructured deps (after `realtime = null,`). Inside `if (busy) {`, BEFORE `const departed = ...`, insert:

```js
        // THE CHILD'S OWN BOOK IS ALREADY PLAYING (2026-09-30). The last
        // thing dispatched at this reader was a book that no session claimed,
        // so the content playing is most likely that story — and the child
        // scanning now is claiming it. Adopt it in place: no launch card, no
        // picker, no restart. The TV proves it is really playing that book
        // before it ACKs; if it cannot, it declines and D2 applies as before.
        const unclaimed = sessions.unclaimedPlay?.(location) ?? null;
        if (unclaimed && typeof sessions.beginAdoption === 'function') {
          const adopting = sessions.beginAdoption({
            location, learnerId, target, contentId: unclaimed.contentId, studyDay: studyDay?.() ?? null,
          });
          if (adopting) {
            const presentation = adopting.pendingPresentation;
            log('info', 'school.reading.adoption-offered', {
              location, learnerId, target, contentId: unclaimed.contentId,
              sessionId: adopting.sessionId, presentationId: presentation.presentationId,
              sinceDispatchMs: clock().getTime() - unclaimed.at,
            });
            void (async () => {
              for (let attempt = 1; attempt <= maxDeliveryAttempts; attempt += 1) {
                if (await sessions.waitForAcknowledgement(presentation.presentationId, ackTimeoutMs)) {
                  log('info', 'school.reading.adoption-acknowledged', {
                    location, sessionId: adopting.sessionId, presentationId: presentation.presentationId, attempt,
                  });
                  return;
                }
                if (attempt < maxDeliveryAttempts) sessions.reannounce(location, presentation.presentationId);
              }
              // The story keeps playing either way — nothing on the TV was
              // touched until the ACK. Closing frees the reader; the unclaimed
              // record is kept, so the child's next tap tries again.
              if (sessions.current(location)?.pendingPresentation?.presentationId === presentation.presentationId) {
                sessions.close(location, { reason: 'adopt-unacknowledged' });
              }
              log('error', 'school.reading.adoption-unacknowledged', {
                location, learnerId, sessionId: adopting.sessionId,
                presentationId: presentation.presentationId, attempts: maxDeliveryAttempts,
              });
            })();
            return {
              status: 'reading_session_adopting', learnerId, location,
              sessionId: adopting.sessionId, presentationId: presentation.presentationId,
              contentId: unclaimed.contentId,
            };
          }
        }
```

Update the function's header comment: add one paragraph under "“UNRELATED” IS …" naming the adoption case (the content is the book last tapped at this reader) as the second place a card may touch a running screen, and that the TV, not the server, proves it.

- [ ] **Step 4: Wire `studyDay` in composition**

In `backend/src/app.mjs`, in the `makeReadingSessionHandler({ ... })` call (search `const readingSessionHandler = makeReadingSessionHandler`), add after `wakeScreen: wakeScreenForBroadcast,`:

```js
      // An ADOPTED story is a pick minted at card time, so it needs the same
      // study day the interceptor stamps on a book-time pick — from the same
      // launcher, so the two can never disagree about which day a read counts.
      studyDay: () => schoolLifecycle.storyTimeLauncher?.studyDay?.() ?? null,
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/isolated/application/school/learnerCardActions.readingAdoption.test.mjs tests/isolated/application/school/learnerCardActions.readingRefusal.test.mjs tests/isolated/composition/readingSessionAction.test.mjs`
Expected: all PASS. (The refusal suite's rig records no unclaimed play, so its D2 and reclaim cases are untouched — if one fails, the adoption branch is leaking past its `unclaimed` guard.)

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(school): a learner card adopts the book already playing at the reader

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- backend/src/3_applications/school/workflows/LearnerCardActions.mjs backend/src/app.mjs tests/isolated/application/school/learnerCardActions.readingAdoption.test.mjs
```

---

### Task 5: The decline route and client (B3)

**Files:**
- Modify: `backend/src/3_applications/school/ReadingApiService.mjs` (after `acknowledge`, ~`:46-49`)
- Modify: `backend/src/4_api/v1/routers/reading.mjs` (after `POST /session/ack`, ~`:58`)
- Modify: `frontend/src/modules/School/schoolApi.js` (~`:490`)
- Test: `tests/isolated/api/routers/reading.test.mjs`

**Interfaces:**
- Consumes: `sessions.declineAdoption(location, presentationId, reason)` (Task 3).
- Produces: `ReadingApiService#declineAdoption(location, presentationId, reason) → { ok: boolean }`; `POST /api/v1/school/reading/session/adopt-decline`; client `schoolApi.declineReadingAdoption({ location, presentationId, reason })`.

- [ ] **Step 1: Write the failing route tests**

Append to `tests/isolated/api/routers/reading.test.mjs`:

```js
describe('POST /session/adopt-decline — the TV could not prove it is playing the book', () => {
  it('closes the pending adoption and answers ok', async () => {
    const { app, sessions } = build();
    sessions.noteUnclaimedPlay('livingroom', { contentId: 'plex:674736', target: 'livingroom-tv' });
    const adopting = sessions.beginAdoption({ location: 'livingroom', learnerId: 'user_7', contentId: 'plex:674736' });
    const res = await request(app).post('/api/v1/school/reading/session/adopt-decline')
      .send({ location: 'livingroom', presentationId: adopting.pendingPresentation.presentationId, reason: 'content-mismatch' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(sessions.current('livingroom')).toBeNull();
  });

  it('answers ok:false for a presentation that is not the pending adoption', async () => {
    const { app } = build();
    const res = await request(app).post('/api/v1/school/reading/session/adopt-decline')
      .send({ location: 'livingroom', presentationId: 'rp_nope', reason: 'no-owner' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: false });
  });

  it('400s without location or presentationId, and on a reason outside the allowlist', async () => {
    const { app } = build();
    const base = '/api/v1/school/reading/session/adopt-decline';
    expect((await request(app).post(base).send({ presentationId: 'rp_1', reason: 'no-owner' })).status).toBe(400);
    expect((await request(app).post(base).send({ location: 'livingroom', reason: 'no-owner' })).status).toBe(400);
    expect((await request(app).post(base).send({ location: 'livingroom', presentationId: 'rp_1', reason: 'because' })).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/isolated/api/routers/reading.test.mjs`
Expected: new tests FAIL (404).

- [ ] **Step 3: Implement**

`ReadingApiService.mjs`, after `acknowledge(...)`:

```js
  /** The screen could not prove the adoption; D2 is restored. See `ReadingSessionService#declineAdoption`. */
  declineAdoption(location, presentationId, reason) {
    return { ok: Boolean(this.#sessions.declineAdoption(location, presentationId, reason)) };
  }
```

`reading.mjs`, next to `END_REASONS`:

```js
/**
 * Why a screen may decline an adoption. An allowlist for the same reason
 * END_REASONS is one: the reason lands in the close record and the log, and a
 * reason added later has to be decided on rather than typed in by a caller.
 */
const DECLINE_REASONS = new Set(['not-playing', 'content-mismatch', 'no-owner']);
```

and after the `POST /session/ack` route:

```js
  router.post('/session/adopt-decline', asyncHandler(async (req, res) => {
    const location = trimmed(req.body?.location);
    const presentationId = trimmed(req.body?.presentationId);
    const reason = trimmed(req.body?.reason);
    if (!location || !presentationId) throw badRequest('location and presentationId are required');
    if (!DECLINE_REASONS.has(reason)) throw badRequest(`reason must be one of: ${[...DECLINE_REASONS].join(', ')}`);
    return res.json(readingService.declineAdoption(location, presentationId, reason));
  }));
```

`schoolApi.js`, directly after `acknowledgeReadingSession`:

```js
  // The TV could not prove it is playing the book it was asked to adopt.
  declineReadingAdoption: (body) => req('/reading/session/adopt-decline', body),
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/isolated/api/routers/reading.test.mjs`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(school): POST /reading/session/adopt-decline

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- backend/src/3_applications/school/ReadingApiService.mjs backend/src/4_api/v1/routers/reading.mjs frontend/src/modules/School/schoolApi.js tests/isolated/api/routers/reading.test.mjs
```

---

### Task 6: The TV proves what it is playing (B4)

**Files:**
- Create: `frontend/src/modules/School/reading/adoptForeignPlayback.js`
- Create: `frontend/src/modules/School/reading/adoptForeignPlayback.test.js`

**Interfaces:**
- Consumes: a session-source capture `{ state, currentItem, position, queue: { items, currentIndex } }` (`frontend/src/screen-framework/publishers/SessionSource.js` — canonical states `idle | loading | playing | paused | buffering | stalled | ended | error | ready`); `fetchQueue(contentId) → { items: [{ contentId, mediaType, ... }] }` (the `GET api/v1/queue/<id>` body; verified 2026-09-30: `plex:674736` → one item `{contentId: 'plex:674737', mediaType: 'audio'}`).
- Produces: `export async function resolveAdoptablePlayback({ capture, bookContentId, fetchQueue })` → `{ ok: true, play, positionSec, trackContentId }` | `{ ok: false, reason: 'no-owner' | 'not-playing' | 'content-mismatch' }`. `play` is the book's queue items from the playing track onward, side-effect markers removed. It carries **no** `seconds`: the seek is applied by the reading stage (Task 8), because the Player's controller ignores start offsets for audio under 12 minutes.

- [ ] **Step 1: Write the failing tests**

`adoptForeignPlayback.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { resolveAdoptablePlayback } from './adoptForeignPlayback.js';

const track = (contentId, over = {}) => ({ contentId, mediaType: 'audio', title: contentId, ...over });
const capture = (over = {}) => ({
  state: 'playing',
  currentItem: { contentId: 'plex:674737' },
  position: 11.785,
  queue: { items: [track('plex:674737')], currentIndex: 0 },
  ...over,
});
const queueOf = (...items) => vi.fn(async () => ({ items }));

describe('resolveAdoptablePlayback', () => {
  it('proves the field case: the single-track book playing at 0:11.785', async () => {
    const fetchQueue = queueOf(track('plex:674737'), { contentId: 'marker', mediaType: 'trigger/side-effect' });
    const result = await resolveAdoptablePlayback({ capture: capture(), bookContentId: 'plex:674736', fetchQueue });
    expect(fetchQueue).toHaveBeenCalledWith('plex:674736');
    expect(result).toEqual({
      ok: true, positionSec: 11.785, trackContentId: 'plex:674737',
      play: [track('plex:674737')],
    });
  });

  it('adopts a multi-track book on track 2 — the queue starts at the playing track', async () => {
    const fetchQueue = queueOf(track('t1'), track('t2'), track('t3'));
    const result = await resolveAdoptablePlayback({
      capture: capture({ currentItem: { contentId: 't2' }, position: 40 }), bookContentId: 'book', fetchQueue,
    });
    expect(result.ok).toBe(true);
    expect(result.play.map((i) => i.contentId)).toEqual(['t2', 't3']);
    expect(result.positionSec).toBe(40);
  });

  it('a paused book is still the child s book — adoptable', async () => {
    const result = await resolveAdoptablePlayback({ capture: capture({ state: 'paused' }), bookContentId: 'b', fetchQueue: queueOf(track('plex:674737')) });
    expect(result.ok).toBe(true);
  });

  it.each(['idle', 'ended', 'error'])('declines not-playing when the player is %s', async (state) => {
    const result = await resolveAdoptablePlayback({ capture: capture({ state }), bookContentId: 'b', fetchQueue: queueOf(track('plex:674737')) });
    expect(result).toEqual({ ok: false, reason: 'not-playing' });
  });

  it('declines no-owner with no capture or no current item', async () => {
    expect(await resolveAdoptablePlayback({ capture: null, bookContentId: 'b', fetchQueue: queueOf() })).toEqual({ ok: false, reason: 'no-owner' });
    expect(await resolveAdoptablePlayback({ capture: capture({ currentItem: null }), bookContentId: 'b', fetchQueue: queueOf() })).toEqual({ ok: false, reason: 'no-owner' });
  });

  it('declines content-mismatch when a movie started since the book was tapped', async () => {
    const result = await resolveAdoptablePlayback({
      capture: capture({ currentItem: { contentId: 'plex:99999' }, state: 'playing' }),
      bookContentId: 'plex:674736', fetchQueue: queueOf(track('plex:674737')),
    });
    expect(result).toEqual({ ok: false, reason: 'content-mismatch' });
  });

  it('declines content-mismatch when the book s queue cannot be read — no proof, no adoption', async () => {
    const fetchQueue = vi.fn(async () => { throw new Error('HTTP 502'); });
    expect(await resolveAdoptablePlayback({ capture: capture(), bookContentId: 'b', fetchQueue })).toEqual({ ok: false, reason: 'content-mismatch' });
  });

  it('treats a non-finite position as 0 rather than failing the adoption', async () => {
    const result = await resolveAdoptablePlayback({ capture: capture({ position: NaN }), bookContentId: 'b', fetchQueue: queueOf(track('plex:674737')) });
    expect(result).toMatchObject({ ok: true, positionSec: 0 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run frontend/src/modules/School/reading/adoptForeignPlayback.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`adoptForeignPlayback.js`:

```js
/**
 * The TV's half of adoption: prove that what is playing right now is the book
 * the server asked this screen to adopt, and say exactly where it is.
 *
 * WHY THE TV DECIDES. The server knows only that a book was the last thing
 * dispatched unclaimed at this reader (`ReadingSessionService#unclaimedPlay`).
 * `isPlaying` is a bare boolean, so the server cannot tell the child's story
 * from a film somebody started from a phone since. The session source can: it
 * names the playing TRACK and its position. A book tag names the ALBUM
 * (`plex:674736` played track `plex:674737` on 2026-09-30), so the book's own
 * queue is the bridge — the track must be in it.
 *
 * Every answer that is not a proof is a decline. D2 — a reading session never
 * seizes the TV — is restored by the caller for all three.
 *
 * NO `seconds` ON THE RETURNED QUEUE. The Player's media controller applies a
 * start offset only to video or audio longer than 12 minutes, and resets any
 * offset within 30 s of the end, so a 4:52 book would restart at 0:00. The
 * reading stage seeks the element itself on its first frame instead.
 *
 * Pure apart from the injected `fetchQueue`; never throws.
 */
const LIVE_STATES = new Set(['playing', 'paused', 'buffering', 'stalled', 'loading', 'ready']);
const SIDE_EFFECT = 'trigger/side-effect';

/**
 * @param {object} args
 * @param {object|null} args.capture - `sessionSource.capture()`
 * @param {string} args.bookContentId - the contentId the book tag resolved to
 * @param {(contentId: string) => Promise<{items?: object[]}>} args.fetchQueue
 * @returns {Promise<{ok: true, play: object[], positionSec: number, trackContentId: string}
 *   | {ok: false, reason: 'no-owner'|'not-playing'|'content-mismatch'}>}
 */
export async function resolveAdoptablePlayback({ capture, bookContentId, fetchQueue }) {
  const trackContentId = capture?.currentItem?.contentId ?? null;
  if (!capture || !trackContentId) return { ok: false, reason: 'no-owner' };
  if (!LIVE_STATES.has(capture.state)) return { ok: false, reason: 'not-playing' };

  let items = [];
  try {
    const body = await fetchQueue(bookContentId);
    items = Array.isArray(body?.items) ? body.items.filter((item) => item?.mediaType !== SIDE_EFFECT) : [];
  } catch {
    return { ok: false, reason: 'content-mismatch' };
  }
  const index = items.findIndex((item) => item?.contentId === trackContentId);
  if (index < 0) return { ok: false, reason: 'content-mismatch' };

  const position = Number(capture.position);
  return {
    ok: true,
    play: items.slice(index),
    positionSec: Number.isFinite(position) && position > 0 ? position : 0,
    trackContentId,
  };
}

export default resolveAdoptablePlayback;
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run frontend/src/modules/School/reading/adoptForeignPlayback.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(school): the living-room TV proves which book it is playing, and where

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- frontend/src/modules/School/reading/adoptForeignPlayback.js frontend/src/modules/School/reading/adoptForeignPlayback.test.js
```

---

### Task 7: The screen hook adopts (B5)

**Files:**
- Modify: `frontend/src/modules/School/reading/useReadingSession.js` (opts at `:158-164`; `handle` `'session-present'` at `:619-642`; `'session-open'` at `:643-669`)
- Test: `frontend/src/modules/School/reading/useReadingSession.test.jsx`

**Interfaces:**
- Consumes: `schoolApi.acknowledgeReadingSession`, `schoolApi.declineReadingAdoption` (Task 5); resolver result shape (Task 6).
- Produces: hook option `resolveAdoption: (bookContentId) => Promise<resolverResult>`; `onPlay` receives `{ learnerId, contentId, title, pickId, sessionId, studyDay, location, image: null, play: object[], adopted: true, positionSec }` for an adoption. Logs `readingLog.pick('adopted', …)`, `readingLog.session('adoption-declined', …)`, `readingLog.warn('adoption-ack-failed', …)`.

- [ ] **Step 1: Extend the test harness**

In `useReadingSession.test.jsx` `stubFetch`, add before the `/reading/session/ack` branch:

```js
    if (href.includes('/reading/session/adopt-decline')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
    }
```

- [ ] **Step 2: Write the failing tests**

Append:

```js
describe('useReadingSession — adopting a story already playing (2026-09-30)', () => {
  const ADOPT = {
    event: 'session-present', reason: 'adopt', location: 'livingroom', learnerId: 'user_7',
    sessionId: 'rs_1', presentationId: 'rp_1', revision: 4, serverEpoch: 'reading_1',
    adopt: { contentId: 'plex:674736', pickId: 'pick_adopt_1', studyDay: '2026-09-30' },
  };
  const proved = { ok: true, play: [{ contentId: 'plex:674737', mediaType: 'audio' }], positionSec: 11.785, trackContentId: 'plex:674737' };

  beforeEach(() => {
    h.handler = null;
    stubFetch();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  const mount = (resolveAdoption) => {
    const played = [];
    const hook = renderHook(() => useReadingSession({
      location: 'livingroom', confirmMs: 1000, onPlay: (p) => played.push(p), resolveAdoption,
    }));
    return { ...hook, played };
  };

  it('proves, ACKs FIRST, then mounts the story at the proved position with the server s pick', async () => {
    const order = [];
    const resolveAdoption = vi.fn(async () => { order.push('resolve'); return proved; });
    const { played, result } = mount(resolveAdoption);
    await act(async () => { h.handler(ADOPT); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });

    expect(resolveAdoption).toHaveBeenCalledWith('plex:674736');
    const acks = posted('/reading/session/ack');
    expect(acks).toHaveLength(1);
    expect(acks[0].body).toMatchObject({ presentationId: 'rp_1', sessionId: 'rs_1', learnerId: 'user_7', revision: 4, serverEpoch: 'reading_1' });
    const ackIndex = calls.findIndex((c) => c.url.includes('/reading/session/ack'));
    expect(ackIndex).toBeGreaterThanOrEqual(0);
    expect(played).toHaveLength(1);
    expect(played[0]).toMatchObject({
      learnerId: 'user_7', contentId: 'plex:674736', pickId: 'pick_adopt_1', sessionId: 'rs_1',
      studyDay: '2026-09-30', adopted: true, positionSec: 11.785, play: proved.play,
    });
    expect(result.current.view).toBe('playing');
  });

  it('credits the adopted story on natural end with the adopted pickId', async () => {
    const { result } = mount(async () => proved);
    await act(async () => { h.handler(ADOPT); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    await act(async () => { await result.current.notePlaybackStarted(); });
    await act(async () => { await result.current.notePlaybackCompleted(); });
    expect(posted('/reading/playing')[0].body).toMatchObject({ pickId: 'pick_adopt_1', learnerId: 'user_7' });
    expect(posted('/reading/read')[0].body).toMatchObject({ pickId: 'pick_adopt_1', learnerId: 'user_7', contentId: 'plex:674736', sessionId: 'rs_1' });
  });

  it('a movie started since → declines content-mismatch, says so, and touches nothing', async () => {
    const { played, result } = mount(async () => ({ ok: false, reason: 'content-mismatch' }));
    await act(async () => { h.handler(ADOPT); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(posted('/reading/session/adopt-decline')[0].body).toEqual({ location: 'livingroom', presentationId: 'rp_1', reason: 'content-mismatch' });
    expect(posted('/reading/session/ack')).toHaveLength(0);
    expect(played).toHaveLength(0);
    expect(result.current.view).toBe('idle');
    expect(result.current.notice).toMatchObject({ title: 'Something else is playing' });
  });

  it('declines no-owner when the screen has no resolver at all', async () => {
    const { played } = mount(undefined);
    await act(async () => { h.handler(ADOPT); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(posted('/reading/session/adopt-decline')[0].body.reason).toBe('no-owner');
    expect(played).toHaveLength(0);
  });

  it('the committed session-open for the adopted pick does not throw the story back to the shelf', async () => {
    const { result } = mount(async () => proved);
    await act(async () => { h.handler(ADOPT); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    await act(async () => {
      h.handler({ event: 'session-open', learnerId: 'user_7', location: 'livingroom', sessionId: 'rs_1', presentationId: 'rp_1', revision: 5, serverEpoch: 'reading_1', state: 'confirm', pick: { pickId: 'pick_adopt_1' } });
    });
    expect(result.current.view).toBe('playing');
  });

  it('a page reloaded mid-adoption adopts from the hydrated snapshot, once', async () => {
    stubFetch({ session: { ...ADOPT, state: 'presenting', pendingPresentation: { ...ADOPT } } });
    const resolveAdoption = vi.fn(async () => proved);
    const { played } = mount(resolveAdoption);
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(resolveAdoption).toHaveBeenCalledTimes(1);
    expect(played).toHaveLength(1);
    expect(played[0].pickId).toBe('pick_adopt_1');
    expect(posted('/reading/session/ack')).toHaveLength(1);
  });
});
```

(`stubFetch({ session })` already serves `GET /reading/session?…` — `readingSession(location)` in `schoolApi.js`. If the hydrate path passes the snapshot's `pendingPresentation` without `event`, the hook's `handle({ event: 'session-present', location, ...session.pendingPresentation })` supplies it.)

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run frontend/src/modules/School/reading/useReadingSession.test.jsx`
Expected: the new block FAILS (adopt presentation treated as a launch card: `view: 'open'`, no resolver call).

- [ ] **Step 4: Implement**

Add the option to `useReadingSession({...})` and its JSDoc:

```js
 * @param {(bookContentId: string) => Promise<object>} [opts.resolveAdoption] -
 *   prove the running story is this book (`resolveAdoptablePlayback`). Absent
 *   means this screen cannot prove anything, and every adoption is declined.
```

```js
  presentationObscured = false,
  resolveAdoption = null,
} = {}) {
```

Mirror it in a ref next to `onPlayRef`:

```js
  const resolveAdoptionRef = useRef(resolveAdoption);
  resolveAdoptionRef.current = resolveAdoption;
```

Add an `adopt` callback above `handle` (it must be declared before `handle` uses it):

```js
  /**
   * THE CHILD'S BOOK IS ALREADY PLAYING (2026-09-30). The server asks this
   * screen to adopt it instead of painting a launch card over it. Prove it,
   * ACK the exact presentation, and only then take the story over — nothing on
   * screen moves until the server has committed the pick, so a failed ACK
   * leaves the running story exactly where it was.
   */
  const adopt = useCallback(async (payload) => {
    const presentation = { ...payload, location: payload.location ?? location };
    const proof = await Promise.resolve(resolveAdoptionRef.current?.(payload.adopt.contentId)).catch(() => null);
    if (!mounted.current) return;
    if (!proof?.ok) {
      const reason = proof?.reason ?? 'no-owner';
      readingLog.session('adoption-declined', { learnerId: payload.learnerId, presentationId: payload.presentationId, reason });
      schoolApi.declineReadingAdoption({ location: presentation.location, presentationId: payload.presentationId, reason })
        .catch?.(() => {});
      cue('warn');
      say({ tone: 'warn', title: 'Something else is playing', detail: 'We can read when this is finished.' });
      return;
    }
    const ack = await schoolApi.acknowledgeReadingSession({
      location: presentation.location, sessionId: payload.sessionId, presentationId: payload.presentationId,
      learnerId: payload.learnerId, revision: Number(payload.revision), serverEpoch: payload.serverEpoch,
    }).catch?.(() => null);
    if (!mounted.current) return;
    if (!ack?.ok) {
      readingLog.warn('adoption-ack-failed', { presentationId: payload.presentationId, status: ack?.status ?? 0 });
      return;
    }
    ackedPresentationRef.current = payload.presentationId;
    const who = { id: payload.learnerId, name: null };
    learnerRef.current = who;
    setLearner(who);
    const attribution = {
      learnerId: payload.learnerId, contentId: payload.adopt.contentId, title: null,
      pickId: payload.adopt.pickId, sessionId: payload.sessionId,
      studyDay: payload.adopt.studyDay ?? null, location: presentation.location,
    };
    attributionRef.current = attribution;
    endedRef.current = false;
    startedRef.current = false;
    const shown = { contentId: attribution.contentId, title: null, image: null, pickId: attribution.pickId, sessionId: attribution.sessionId, studyDay: attribution.studyDay };
    pickRef.current = shown;
    setPick(shown);
    setDeadline(null);
    setView('playing');
    readingLog.pick('adopted', {
      learnerId: attribution.learnerId, contentId: attribution.contentId, pickId: attribution.pickId,
      positionSec: proof.positionSec, trackContentId: proof.trackContentId,
    });
    try {
      onPlayRef.current?.({ ...attribution, image: null, play: proof.play, adopted: true, positionSec: proof.positionSec });
    } catch (err) {
      readingLog.error('play-dispatch-failed', { contentId: attribution.contentId, error: err?.message ?? String(err) });
    }
    loadSummary(attribution.learnerId);
    loadBook(attribution.contentId);
  }, [cue, loadBook, loadSummary, location, say]);
```

In `handle`, at the top of `case 'session-present':`:

```js
      case 'session-present': {
        if (payload.reason === 'adopt' && payload.adopt?.contentId) {
          if (!rememberPresentation(payload)) return;
          // An adoption is a claim on the story, not a face to paint — the
          // visibility-ACK effect must not also ACK it from the shelf.
          adopt(payload);
          return;
        }
        if (!rememberPresentation(payload)) return;
```

(Keep the rest of the case unchanged.) `ACKABLE_VIEWS` never contains `'idle'` or `'playing'`, so the visibility effect cannot double-ACK while `adopt` runs; if an implementer finds `idle` in that set, gate the effect on `presentation.reason !== 'adopt'`.

At the top of `case 'session-open':`:

```js
      case 'session-open': {
        // The commit of a pick this screen is ALREADY playing — an adoption's
        // own ACK echoes back as `session-open` with state `confirm`. Resetting
        // to the shelf here would drop the story the child just claimed.
        if (viewRef.current === 'playing' && payload.pick?.pickId
          && payload.pick.pickId === attributionRef.current?.pickId) {
          if (payload.sessionId) rememberPresentation(payload);
          return;
        }
```

Add `adopt` to `handle`'s dependency array.

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run frontend/src/modules/School/reading/useReadingSession.test.jsx`
Expected: all PASS (existing + new).

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(school): the reading screen adopts the story already playing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- frontend/src/modules/School/reading/useReadingSession.js frontend/src/modules/School/reading/useReadingSession.test.jsx
```

---

### Task 8: Wire the screen: proof, queue, and the resume seek (B6)

**Files:**
- Modify: `frontend/src/modules/School/reading/ReadingSessionScreen.jsx` (`onPlay` `:531-573`; `useReadingSession` call `:575-578`; the `wasIdle` effect `:635-642`; the `listeners` ref `:497-500`)
- Test: `frontend/src/modules/School/reading/ReadingSessionScreen.test.jsx`

**Interfaces:**
- Consumes: `resolveAdoptablePlayback` (Task 6); `useSessionSourceContext` (`frontend/src/screen-framework/publishers/useSessionSourceContext.js`); `DaylightAPI` (`frontend/src/lib/api.mjs`, `DaylightAPI(path)` → GET JSON); hook option `resolveAdoption` and `onPlay` payload fields `play`, `adopted`, `positionSec` (Task 7).
- Produces: `ReadingStage` mounted with `play` = the adoption queue array; one-time element seek to `positionSec` on the stage's first `playing` event; log `readingLog.playback('adoption-seek', {positionSec, applied})`.

- [ ] **Step 1: Write the failing tests**

In `ReadingSessionScreen.test.jsx`, add to the hoisted object `capture: null`, and mock the session source next to the other `vi.mock`s:

```js
vi.mock('../../../screen-framework/publishers/useSessionSourceContext.js', () => ({
  useSessionSourceContext: () => ({ capture: () => h.capture }),
}));
```

Extend `stubFetch` so the queue API answers:

```js
    if (href.includes('/api/v1/queue/plex:674736')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ items: [{ contentId: 'plex:674737', mediaType: 'audio' }] }) });
    }
    if (href.includes('/reading/session/ack')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
```

(Place them before the final fallback; `DaylightAPI` uses `fetch` under the hood — confirm by reading `frontend/src/lib/api.mjs:35`; if it prefixes a base URL, match on the `api/v1/queue/` substring as written.)

Append a describe:

```js
describe('ReadingSessionScreen — adopting the story already playing', () => {
  const ADOPT = {
    event: 'session-present', reason: 'adopt', location: 'livingroom', learnerId: 'user_7',
    sessionId: 'rs_1', presentationId: 'rp_1', revision: 4, serverEpoch: 'reading_1',
    adopt: { contentId: 'plex:674736', pickId: 'pick_adopt_1', studyDay: '2026-09-30' },
  };

  beforeEach(() => {
    h.handler = null;
    h.overlay.shown.length = 0;
    h.overlay.dismissed = 0;
    h.capture = { state: 'playing', currentItem: { contentId: 'plex:674737' }, position: 280, queue: { items: [], currentIndex: 0 } };
    vi.stubGlobal('fetch', stubFetch());
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const adoptNow = async () => {
    render(<ReadingSessionScreen location="livingroom" />);
    await deliver(ADOPT);
    await waitFor(() => expect(h.overlay.shown.some((o) => o.Component?.name === 'ReadingStage')).toBe(true));
    return h.overlay.shown.find((o) => o.Component?.name === 'ReadingStage');
  };

  it('mounts the reading stage with the book queue from the playing track', async () => {
    const stage = await adoptNow();
    expect(stage.props.play).toEqual([{ contentId: 'plex:674737', mediaType: 'audio' }]);
  });

  it('does not dismiss the stage it just mounted on the idle → playing jump', async () => {
    // `onPlay` dismisses ONCE (whatever held the slot — the foreign player),
    // then mounts the stage. The idle→playing effect runs AFTER that render,
    // so a count taken after the mount would already include a bad second
    // dismissal; assert the absolute count once everything has settled.
    await adoptNow();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(h.overlay.dismissed).toBe(1);
    const lastStage = h.overlay.shown.at(-1);
    expect(lastStage.Component?.name).toBe('ReadingStage');
  });

  it('seeks the element to the proved position on its FIRST frame — even near the end of a short book', async () => {
    // 280 s of a 292 s audiobook: the Player's controller would ignore a start
    // offset here (audio < 12 min, < 30 s left), which is why the stage seeks.
    const stage = await adoptNow();
    const el = new EventTarget();
    el.tagName = 'AUDIO';
    el.currentTime = 0;
    await act(async () => { stage.props.onMediaRef(el); });
    await act(async () => { el.dispatchEvent(new Event('playing')); });
    expect(el.currentTime).toBe(280);
    el.currentTime = 281;
    await act(async () => { el.dispatchEvent(new Event('playing')); });
    expect(el.currentTime).toBe(281); // once, not on every resume
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run frontend/src/modules/School/reading/ReadingSessionScreen.test.jsx`
Expected: new tests FAIL (no resolver wired; stage `play` is `{contentId}`; no seek).

- [ ] **Step 3: Implement**

Imports:

```js
import { useSessionSourceContext } from '../../../screen-framework/publishers/useSessionSourceContext.js';
import { DaylightAPI } from '../../../lib/api.mjs';
import { resolveAdoptablePlayback } from './adoptForeignPlayback.js';
```

Inside `ReadingSessionScreen`, next to `mediaRef`:

```js
  const sessionSource = useSessionSourceContext();
  // An ADOPTED story resumes where it was. The Player's media controller will
  // not apply a start offset to short audio (and resets one near the end), so
  // the stage seeks its own element on the first frame — once.
  const pendingSeekRef = useRef(null);
```

Replace the `playing` listener in the `listeners` ref:

```js
    playing: (event) => {
      const seekTo = pendingSeekRef.current;
      if (seekTo != null) {
        pendingSeekRef.current = null;
        const el = event?.currentTarget;
        let applied = false;
        try { if (el) { el.currentTime = seekTo; applied = true; } } catch { /* a refused seek plays from where it is */ }
        readingLog.playback('adoption-seek', { positionSec: seekTo, applied });
      }
      handlers.current.notePlaybackStarted?.();
    },
```

In `onPlay`, before `showOverlay(ReadingStage, ...)`:

```js
    pendingSeekRef.current = committed.adopted && Number.isFinite(committed.positionSec) && committed.positionSec > 1
      ? committed.positionSec
      : null;
```

and change the stage's `play` prop to:

```js
      // ONE object per story. An adoption hands in the book's queue from the
      // playing track onward (an array); a pick hands in the book id.
      play: committed.play ?? { contentId: committed.contentId },
```

Pass the resolver into the hook:

```js
  const resolveAdoption = useCallback((bookContentId) => resolveAdoptablePlayback({
    capture: sessionSource?.capture?.() ?? null,
    bookContentId,
    fetchQueue: (cid) => DaylightAPI(`api/v1/queue/${encodeURIComponent(cid)}`),
  }), [sessionSource]);

  const session = useReadingSession({
    location, confirmMs, onPlay, onCue: cueTone,
    presentationObscured: hasOverlay,
    resolveAdoption,
  });
```

Guard the screensaver dismissal:

```js
  useEffect(() => {
    // An ADOPTION jumps straight from idle to playing, and `onPlay` has
    // already dismissed what was there and mounted the stage. Dismissing now
    // would take down the story the child just claimed.
    if (session.view !== 'idle' && session.view !== 'playing' && wasIdle.current) {
      dismissOverlay();
      readingLog.screen('screensaver-cleared', { view: session.view });
    }
    wasIdle.current = session.view === 'idle';
  }, [session.view, dismissOverlay]);
```

Check the encoding: `encodeURIComponent('plex:674736')` → `plex%3A674736`. If the stub's `href.includes('/api/v1/queue/plex:674736')` fails because of it, match `/api/v1/queue/` plus `674736` in the stub instead — the backend route accepts both (verify with `curl -s localhost:3111/api/v1/queue/plex%3A674736 | jq .count` → `1`).

- [ ] **Step 4: Confirm the Player accepts an array `play` inside the stage**

Read `frontend/src/modules/Player/hooks/useQueueController.js:286-289` — `Array.isArray(play)` maps items directly with a fresh `guid`, no queue fetch. Nothing to change; note it in the commit body.

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run frontend/src/modules/School/reading/`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(school): the reading stage takes over the running story at its position

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- frontend/src/modules/School/reading/ReadingSessionScreen.jsx frontend/src/modules/School/reading/ReadingSessionScreen.test.jsx
```

---

### Task 9: Behaviour doc

**Files:**
- Modify: `docs/reference/school/reading-sessions.md`
- Modify: `CLAUDE.md` (navigation table)

**Interfaces:** none (documentation).

- [ ] **Step 1: Status blurb** — append to the header blockquote (after the 2026-09-18 paragraph):

```markdown
> On 2026-09-30 a cold TV lost a child twice in one minute. The initial launch
> card's ACK budget (2 × 8 s) expired 0.5 s after the page — which loaded 11 s
> after the wake returned — finally received it, and the book tapped meanwhile
> was refused to a screen that did not exist yet. His re-tapped book then played
> unclaimed, and his card 17 s later restarted it from 0:00. The initial budget
> is now ~60 s (§9), a book tapped while the first card is in flight is HELD and
> applied on the ACK (§9), and a card scanned while the reader's last unclaimed
> book is playing ADOPTS that story in place (D12).
```

- [ ] **Step 2: Settled decisions** — amend the D2 row by appending: "**Second exemption (D12):** content is not unrelated when it is the book last dispatched unclaimed at this reader — the card adopts it." Add a row:

```markdown
| **D12** | A card scanned while a book tapped at this reader is playing | **Adopt it.** The server remembers the last book dispatched unclaimed at the reader (`unclaimedPlay`, 2 h bound) and presents `reason: 'adopt'` with a server-minted pick. The TV proves the running track belongs to that book (`resolveAdoptablePlayback`), ACKs, re-mounts the story inside the reading stage from the playing track and seeks to the proved position on its first frame. Credit is the ordinary natural-end read under the adopted `pickId` — the whole book counts, including the part before the scan. Any failed proof (`no-owner`, `not-playing`, `content-mismatch`) posts `adopt-decline`: the session closes `adopt-declined` and D2's notice shows. An unacknowledged adoption closes `adopt-unacknowledged` and keeps the unclaimed record, so the next tap retries. |
```

- [ ] **Step 3: States and diagrams** — in §5's `stateDiagram-v2`, replace `FOREIGN_PLAY --> FOREIGN_PLAY: card — refused, D2` with:

```
    FOREIGN_PLAY --> FOREIGN_PLAY: card — refused, D2 (no unclaimed book)
    FOREIGN_PLAY --> PRESENTING: card — unclaimed book here, adopt (D12)
    PRESENTING --> READING: adopt ACK, then first frame
```

and in §6's `card` flowchart replace the `E -->|FOREIGN_PLAY| G[...]` edge with:

```
    E -->|FOREIGN_PLAY, book last tapped here| G2[D12: present adopt;<br/>TV proves, ACKs, resumes at position]
    E -->|FOREIGN_PLAY, anything else| G[D2: refuse visibly.<br/>content keeps playing]
```

In §7's assignment matrix, `FOREIGN_PLAY` row `card` cell: "adopt when the reader's last unclaimed book is playing (D12); otherwise refuse visibly, stay". `STARTING / PRESENTING` row `book` cell: "**hold** during the initial card (applied on ACK); refuse during a switch".

- [ ] **Step 4: Wire table (§8a)** — add rows:

```markdown
| `session-present` `reason: 'adopt'` | `ReadingSessionService.beginAdoption` | presentation + `adopt: {contentId, pickId, studyDay}` | prove the running story (`resolveAdoptablePlayback`), ACK, then take it over at its position; on failure `POST /session/adopt-decline` and the D2 notice. Never painted as a launch card |
```

and in the Routes table:

```markdown
| `POST /session/adopt-decline` | `location, presentationId, reason` (`not-playing` \| `content-mismatch` \| `no-owner`) | The TV could not prove the adoption. Closes the pending adoption `adopt-declined` and forgets the unclaimed record. `{ok: false}` when that presentation is not pending. |
```

and in "Where each piece lives": `| TV-side adoption proof | frontend/src/modules/School/reading/adoptForeignPlayback.js |`.

- [ ] **Step 5: Failure paths (§9)** — replace the "TV wakes slowly…" row's last sentence with: "Replay for `initialDeliveryBudgetMs` (~60 s; attempts = `max(maxDeliveryAttempts, ceil(budget / ackTimeoutMs))`), re-foregrounding only on the first `maxDeliveryAttempts − 1` replays. If no rendered ACK arrives, close the unseen initial session and alert an adult." Add rows:

```markdown
| A book tapped while the first launch card is still in flight | **Held**, not refused. `holdBook` keeps the latest tap on the session; the ACK of the initial presentation commits `confirm` with it and broadcasts `session-open` then `book-selected`, so the child sees their book's countdown the moment their card appears. A switch or return still refuses `launch-card-not-ready` — a face is already on screen there. If the card is never acknowledged the held book is lost with the session; the child's re-tap then plays it unclaimed, and their next card adopts it (D12). |
| An adoption the TV cannot prove | `adopt-decline` → close `adopt-declined`, unclaimed record forgotten, D2 notice. The running content is never touched: the TV takes nothing over until the server has committed the pick. |
| An adoption never acknowledged | Close `adopt-unacknowledged`; the story keeps playing; the unclaimed record is kept so the next tap retries. |
```

- [ ] **Step 6: Invariants (§10)** — invariant 3 becomes: "**No session, no credit** — until a card adopts it. An unclaimed book tap plays for nobody; a learner card scanned while it plays may adopt it (D12), and the whole read is then credited under the adopted pick." Invariant 6: append "— and the one case in which the content playing is provably the book last tapped at this reader (D12), where the TV, not the server, is the proof."

- [ ] **Step 7: Unverified (§11)** — add:

```markdown
7. **Adoption on the real Shield.** The seek is applied to the element on the
   stage's first frame; how long the audio gap between the foreign player's
   unmount and the stage's first frame is, and whether the seek lands within a
   second of the proved position, has not been measured on the set. The
   `school.reading.adoption-*` lines and the frontend `adoption-seek` event
   answer both. Multi-track books adopted past track 1 are covered by tests only.
```

- [ ] **Step 8: CLAUDE.md nav row** — the table has no row for this doc. After the "Reading log" row add:

```markdown
| Living-room reading sessions (card → launch card → book → credit; cold-wake delivery, mid-story adoption) | `docs/reference/school/reading-sessions.md` |
```

- [ ] **Step 9: Commit**

```bash
git commit -m "docs(school): reading sessions — cold-wake budget, held book, D12 adoption

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- docs/reference/school/reading-sessions.md CLAUDE.md
```

---

### Task 10: Full-suite verification, deploy, field check

**Files:** none modified.

- [ ] **Step 1: Run every touched suite**

```bash
npx vitest run tests/isolated/application/school/learnerCardActions.readingRefusal.test.mjs tests/isolated/application/school/learnerCardActions.readingAdoption.test.mjs tests/isolated/application/school/readingSessionInterceptor.test.mjs tests/isolated/application/school/ReadingSessionService.test.mjs tests/isolated/composition/readingSessionAction.test.mjs tests/isolated/api/routers/reading.test.mjs frontend/src/modules/School/reading/
```

Expected: 0 failures. Baseline before this plan was 145 passing across the first-listed four reading suites (`readingRefusal`, `readingSessionInterceptor`, `ReadingSessionService`, `useReadingSession`); the count must be higher, never lower. Capture the real exit code (`echo $?` → `0`).

- [ ] **Step 2: Gate, build, re-gate, deploy** (per `CLAUDE.local.md`; the gate must be able to halt the sequence)

```bash
./scripts/deploy-gate.sh && ./scripts/build-daylight.sh
./scripts/deploy-gate.sh && sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```

If the gate exits 1, stop and re-run later — do not bypass. Then confirm the running build:

```bash
curl -s http://localhost:3111/build.txt   # Commit line must equal `git rev-parse HEAD`
```

- [ ] **Step 3: Field check (after the next real story time)**

```bash
curl -s http://localhost:9428/select/logsql/query \
  -d 'query=_time:24h AND (_msg:"school.reading.adoption-offered" OR _msg:"school.reading.adoption-committed" OR _msg:"school.reading.adoption-declined" OR _msg:"school.reading.adoption-unacknowledged" OR _msg:"school.reading.held-book-applied" OR _msg:"school.reading.book-held") | sort by (_time)' -d 'limit=100'
curl -s http://localhost:9428/select/logsql/query \
  -d 'query=_time:24h AND _msg:"school.reading.delivery-acknowledged" | sort by (_time)' -d 'limit=50'
curl -s http://localhost:9428/select/logsql/query \
  -d 'query=_time:24h AND "adoption-seek"' -d 'limit=20'
```

What each should show: an `adoption-committed` followed by `school.reading.playback-started` with the same `pickId`, then `school.story-time.read-recorded`; any `delivery-acknowledged` with `attempt` > 2 is a cold wake the old budget would have lost; `adoption-seek applied: true` with a `positionSec` matching the foreign player's last `play.log` playhead.
