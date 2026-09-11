# Reading Launch Card & Timeout Race Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stop the living-room reading session losing a child's credit to a 2-minute idle timeout, and rebuild its launch card as a scan-driven *view* — a today card with an empty, glowing slot where the next book goes — rather than a screen that asks a question it gives no way to answer.

**Architecture:** Three independent seams. (1) `ReadingSessionService` remembers the session it just closed, and `ReadingSessionInterceptor` reopens it when a book card lands inside a grace window — this is the actual defect and it is backend-only. (2) `ReadingSessionScreen`'s `open` view gains an always-present today column whose empty slots carry the day's obligation, replacing the pips; the streak wall moves to the ceremony. (3) Two standalone correctness bugs — a UTC/local off-by-one in the weekday label, and unresized Plex covers — that share no code with the other two.

**Tech Stack:** React 18 + SCSS (frontend, vitest + @testing-library/react), Node ES modules (backend, vitest), VictoriaLogs for field verification.

---

## Background: what actually happened

Reconstructed from the log store, 2026-09-11 (one learner at `livingroom`; the real id is in the log store):

```
17:10:48  school.reading.session-open       learner card scanned
17:10:57  school.reading.session-opened     wakeMs=8509
17:11:09  launch card rendered
   …      2m12s of nothing
17:13:21  school.reading.session-close      reason=timeout, idleMs=134980
17:13:30  playback.started                  plex:620707 "The Three Little Pigs"  ← 9s later
17:13:52  wake-and-load.playback.confirmed  deviceId=livingroom-tv
17:14:01  school.reading.session-refused    reason=content-playing
17:15:02  school.reading.session-refused    reason=content-playing
```

The book card **was** scanned, nine seconds after the idle sweep tore the session down. `ReadingSessionInterceptor.claim()` (`readingSessionInterceptor.mjs:89-90`) does `const session = this.#sessions.current(location); if (!session) return null;` — so the tap fell through to the ordinary content dispatch and the story played as plain media. No session, no pick, no credit. `ReadingApiService` has a log line for exactly this outcome: *"the story played and the obligation did not move."*

Then the child was locked out: `LearnerCardActions.mjs:164` refuses a new session while `isPlaying(target)` is true, and the thing playing was the child's own book. That refusal is deliberately non-retryable, so scanning repeatedly did nothing at all.

**Phase 1 fixes the race. Phase 2 fixes the lockout. Both are backend.**

## Conventions for every task

- Run a single test file with `npx vitest run <path>`. Do **not** reach for the `test:backend` / `test:isolated` harnesses for a single file — they route by folder and a file can silently not run (see the `isolated domain tests never run` note).
- Backend tests live under `tests/isolated/application/school/`; frontend tests sit beside their component.
- `frontend/src/lib/logging/Logger.js` is the only logging route. No raw `console.*`.
- Commit after every task. Branch, do not work on `main`.

**Before Task 1 — sync with the deployed tree.** Per `CLAUDE.local.md`, this laptop's git is frequently behind what is actually deployed:

```bash
git fetch origin && git log --oneline origin/main..HEAD
ssh homeserver.local 'cd /opt/Code/DaylightStation && git branch --show-current && git log --oneline origin/main..HEAD | head'
```

If the homeserver is ahead, integrate before starting. Then:

```bash
git checkout -b school/reading-launch-card
```

---

# Phase 1 — The timeout race (backend)

## Task 1: `ReadingSessionService` remembers the session it just closed

**Files:**
- Modify: `backend/src/3_applications/school/ReadingSessionService.mjs` (field block ~line 88, `close()` ~line 679, `open()` ~line 421)
- Test: `tests/isolated/application/school/ReadingSessionService.test.mjs` (append)

**Step 1: Write the failing test**

Append to the test file. Note the existing harness there wraps the production class with a `TEST_SCHEDULER`; reuse whatever local helper that file already defines rather than redeclaring one.

```javascript
describe('ReadingSessionService — the session that just closed', () => {
  it('remembers a timed-out session for the grace window, and forgets it after', () => {
    let now = 1_000_000;
    const sessions = new ReadingSessionService({ logger: silent, clock: () => new Date(now) });
    sessions.open({ location: 'livingroom', learnerId: 'test-learner' });
    sessions.close('livingroom', { reason: 'timeout' });

    now += 9_000; // the nine seconds that cost a real child his credit
    const record = sessions.recentlyClosed('livingroom');
    expect(record).toBeTruthy();
    expect(record.session.learnerId).toBe('test-learner');
    expect(record.reason).toBe('timeout');

    now += 60_000; // well past the window
    expect(sessions.recentlyClosed('livingroom')).toBeNull();
  });

  it('forgets the closed session once a new one is open — a live session is never "recently closed"', () => {
    let now = 1_000_000;
    const sessions = new ReadingSessionService({ logger: silent, clock: () => new Date(now) });
    sessions.open({ location: 'livingroom', learnerId: 'test-learner' });
    sessions.close('livingroom', { reason: 'timeout' });
    sessions.open({ location: 'livingroom', learnerId: 'test-sibling' });
    expect(sessions.recentlyClosed('livingroom')).toBeNull();
  });
});
```

**Step 2: Run it and watch it fail**

```bash
npx vitest run tests/isolated/application/school/ReadingSessionService.test.mjs -t 'just closed'
```
Expected: FAIL — `sessions.recentlyClosed is not a function`.

**Step 3: Implement**

Add the constant beside `DEFAULT_IDLE_TIMEOUT_MS` (~line 49):

```javascript
/**
 * How long after a teardown a book card may still reclaim the session it
 * belongs to.
 *
 * A child who scans their card, chooses a book off the shelf and scans it is
 * doing ONE thing, and the idle sweep cannot see the middle of it. On
 * 2026-09-11 the sweep closed a session at 17:13:21 and the book landed at
 * 17:13:30 — nine seconds — and the story played with nobody's name on it.
 *
 * Deliberately a fraction of the idle timeout, not a second timeout: this does
 * not keep a room alive, it only lets a tap that was ALREADY in flight land
 * where it was aimed.
 */
export const REOPEN_GRACE_MS = 45_000;
```

Add the field next to `#stuckReported` (~line 95):

```javascript
  /** location -> {session, reason, closedAt}: the last teardown, for the reopen grace. */
  #recentlyClosed = new Map();
```

In `close()`, immediately after `this.#sessions.delete(location);`:

```javascript
    this.#recentlyClosed.set(location, {
      session, reason, closedAt: this.#clock().getTime(),
    });
```

In `open()`, beside `this.#stuckReported.delete(session.location);` (~line 423):

```javascript
    // A live session is never "recently closed" — the reopen grace exists for
    // the gap between sessions and must not survive into one.
    this.#recentlyClosed.delete(session.location);
```

And the reader, next to `current()` (~line 252):

```javascript
  /**
   * The session torn down at this reader moments ago, or null.
   *
   * READ ONLY WHEN `current()` IS NULL — this is the gap between a teardown and
   * the tap that was already on its way. See `REOPEN_GRACE_MS`.
   *
   * @returns {{session: object, reason: string|null, closedAt: number}|null}
   */
  recentlyClosed(location, { withinMs = REOPEN_GRACE_MS } = {}) {
    const record = this.#recentlyClosed.get(location) ?? null;
    if (!record) return null;
    if (this.#clock().getTime() - record.closedAt > withinMs) return null;
    return record;
  }
```

**Step 4: Run the whole file**

```bash
npx vitest run tests/isolated/application/school/ReadingSessionService.test.mjs
```
Expected: PASS, including every pre-existing test.

**Step 5: Commit**

```bash
git add backend/src/3_applications/school/ReadingSessionService.mjs tests/isolated/application/school/ReadingSessionService.test.mjs
git commit -m "feat(reading): remember the session a teardown just closed"
```

---

## Task 2: A book card reopens the session that just timed out

**Files:**
- Modify: `backend/src/3_applications/school/readingSessionInterceptor.mjs:85-90`
- Test: `tests/isolated/application/school/readingSessionInterceptor.test.mjs` (append)

This is the fix. `open()` with its default `state = PROMPT` returns the frozen session and broadcasts `session-open`, so the screen re-renders the launch card; the interceptor's existing PROMPT branch then sets `confirm` + `book-selected` and the countdown runs as it always did. The child sees their book, and the read is credited.

**Step 1: Write the failing test**

The file's `build()` helper needs a controllable clock on the sessions store, so construct one explicitly:

```javascript
describe('ReadingSessionInterceptor — the tap that arrived just too late', () => {
  it('reopens a session the idle sweep closed seconds ago, and claims the book', async () => {
    let now = 1_000_000;
    const sessions = new ReadingSessionService({ logger: silent, clock: () => new Date(now) });
    const { interceptor, sent } = build({ sessions });

    sessions.open({ location: 'livingroom', learnerId: 'test-learner' });
    sessions.close('livingroom', { reason: 'timeout' });
    sent.length = 0;

    now += 9_000;
    const claim = await interceptor.claim(bookTap());

    expect(claim).toMatchObject({ claimed: true, by: 'reading-session', learnerId: 'test-learner' });
    expect(claim.refused).toBeFalsy();
    // The screen is told twice, in order: the session is back, then the book.
    expect(sent.map((s) => s.payload.event)).toEqual(['session-open', 'book-selected']);
    expect(sessions.current('livingroom')).toMatchObject({ learnerId: 'test-learner', state: 'confirm' });
  });

  it('does NOT reopen once the grace window has passed — a later tap is somebody browsing', async () => {
    let now = 1_000_000;
    const sessions = new ReadingSessionService({ logger: silent, clock: () => new Date(now) });
    const { interceptor } = build({ sessions });
    sessions.open({ location: 'livingroom', learnerId: 'test-learner' });
    sessions.close('livingroom', { reason: 'timeout' });

    now += 120_000;
    expect(await interceptor.claim(bookTap())).toBeNull();
    expect(sessions.current('livingroom')).toBeNull();
  });

  it('does NOT reopen a session the DAY closed — the day is done and the book is browsing', async () => {
    let now = 1_000_000;
    const sessions = new ReadingSessionService({ logger: silent, clock: () => new Date(now) });
    const { interceptor } = build({ sessions });
    sessions.open({ location: 'livingroom', learnerId: 'test-learner' });
    sessions.close('livingroom', { reason: 'day-done' });

    now += 5_000;
    expect(await interceptor.claim(bookTap())).toBeNull();
  });
});
```

**Step 2: Run it and watch it fail**

```bash
npx vitest run tests/isolated/application/school/readingSessionInterceptor.test.mjs -t 'just too late'
```
Expected: FAIL — `claim` returns `null` because no session is current.

**Step 3: Implement**

Replace lines 89-90 of `readingSessionInterceptor.mjs`:

```javascript
    const session = this.#sessions.current(location) ?? this.#reopenIfJustClosed(location);
    if (!session) return null;
```

And add the method beside `#modeFor`:

```javascript
  /**
   * THE NINE-SECOND GAP. A child scans their card, walks to the shelf, picks a
   * book and scans it — one act, which the idle sweep can land in the middle
   * of. When it does, the book card arrives at a reader with no session and
   * dispatches as ordinary content: the story plays, and the obligation does
   * not move. That is exactly what happened on 2026-09-11 at 17:13:30, nine
   * seconds after a teardown.
   *
   * ONLY A TIMEOUT IS REOPENED. A session closed because the DAY was done is a
   * finished child, and a book tapped after that is browsing — reopening it
   * would re-arm a ceremony that already ran. `REOPEN_GRACE_MS` bounds it.
   *
   * Reopening broadcasts `session-open`, so the screen puts the launch card
   * back before the caller's own `book-selected` lands on it.
   */
  #reopenIfJustClosed(location) {
    const record = this.#sessions.recentlyClosed?.(location) ?? null;
    if (!record || record.reason !== 'timeout') return null;
    const reopened = this.#sessions.open({
      location,
      learnerId: record.session.learnerId,
      target: record.session.target ?? null,
    });
    this.#log('info', 'school.reading.session-reopened', {
      location,
      learnerId: record.session.learnerId,
      sessionId: reopened?.sessionId ?? null,
      closedSessionId: record.session.sessionId,
      sinceCloseMs: this.#clock().getTime() - record.closedAt,
      consequence: 'the book that arrived just after a teardown keeps its credit',
    });
    return reopened;
  }
```

**Step 4: Run the file**

```bash
npx vitest run tests/isolated/application/school/readingSessionInterceptor.test.mjs
```
Expected: PASS, all tests including the pre-existing mode-split suite.

**Step 5: Commit**

```bash
git add backend/src/3_applications/school/readingSessionInterceptor.mjs tests/isolated/application/school/readingSessionInterceptor.test.mjs
git commit -m "fix(reading): a book card reopens the session the idle sweep just closed"
```

---

## Task 3: A learner card is not refused by the child's own book

**Files:**
- Modify: `backend/src/3_applications/school/workflows/LearnerCardActions.mjs:155-171`
- Test: `tests/isolated/application/school/` — find the existing `LearnerCardActions` suite first with `ls tests/isolated/application/school/ | grep -i learnercard`; if none exists, create `tests/isolated/application/school/learnerCardActions.readingRefusal.test.mjs`.

The refusal is right in general — a reading session must never seize a movie — and wrong in the one case that matters: the content playing IS this learner's book, launched seconds ago by their own scan. Task 2 makes this rare, but it is the recovery path when the grace window is missed, and today it is a dead end.

**Step 1: Write the failing test**

```javascript
it('does not refuse a learner whose own just-played book is what is "playing"', async () => {
  let now = 1_000_000;
  const sessions = new ReadingSessionService({ logger: silent, clock: () => new Date(now) });
  sessions.open({ location: 'livingroom', learnerId: 'test-learner' });
  sessions.close('livingroom', { reason: 'timeout' });

  const handler = makeReadingSessionHandler({
    sessions,
    isPlaying: () => true,          // the TV says something is up
    clock: () => new Date(now),
    logger: silent,
  });

  now += 20_000;
  const result = await handler({ learnerId: 'test-learner', location: 'livingroom', target: 'livingroom-tv' });
  expect(result.status).not.toBe('reading_session_refused');
  expect(sessions.current('livingroom')).toMatchObject({ learnerId: 'test-learner' });
});

it('still refuses a learner when the content playing belongs to nobody at this reader', async () => {
  const sessions = new ReadingSessionService({ logger: silent });
  const handler = makeReadingSessionHandler({ sessions, isPlaying: () => true, logger: silent });
  const result = await handler({ learnerId: 'test-learner', location: 'livingroom', target: 'livingroom-tv' });
  expect(result).toMatchObject({ status: 'reading_session_refused', reason: 'content-playing' });
});
```

**Step 2: Run it and watch the first case fail**

```bash
npx vitest run tests/isolated/application/school/learnerCardActions.readingRefusal.test.mjs
```
Expected: the first test FAILS with `status: 'reading_session_refused'`.

**Step 3: Implement**

In the `if (!existing)` block, before `if (busy)`:

```javascript
      // THE CHILD'S OWN BOOK IS NOT "UNRELATED CONTENT".
      //
      // On 2026-09-11 a session timed out, the book card fell through and
      // played the story as ordinary media, and then every re-scan of the
      // learner's card was refused BECAUSE THEIR OWN BOOK WAS PLAYING — a
      // non-retryable refusal, so the child scanned over and over and the
      // screen did nothing at all. The refusal exists to protect a movie
      // somebody else is watching, not to lock a reader out of the room it
      // just left.
      const justLeft = sessions.recentlyClosed?.(location) ?? null;
      const ownRoom = justLeft?.session?.learnerId === learnerId;
```

and change the guard to `if (busy && !ownRoom) {`, with the log line gaining `ownRoom` so the field can tell the two apart:

```javascript
        log('info', 'school.reading.session-refused', { location, learnerId, target, reason: 'content-playing', ownRoom });
```

**Step 4: Run**

```bash
npx vitest run tests/isolated/application/school/learnerCardActions.readingRefusal.test.mjs
```
Expected: PASS both.

**Step 5: Commit**

```bash
git add backend/src/3_applications/school/workflows/LearnerCardActions.mjs tests/isolated/application/school/learnerCardActions.readingRefusal.test.mjs
git commit -m "fix(reading): a learner card is not refused by their own just-played book"
```

---

## Task 4: The screen is told how long its clock is

**Files:**
- Modify: `backend/src/3_applications/school/ReadingSessionService.mjs:400-420` (the frozen session)
- Test: `tests/isolated/application/school/ReadingSessionService.test.mjs`

Phase 3 draws the idle window on screen. The duration must travel with the session rather than being a magic number mirrored in the frontend, or the two will drift the first time anybody tunes the timeout.

**Step 1: Write the failing test**

```javascript
it('publishes its own idle window, so the screen can draw the clock it is actually running', () => {
  const sessions = new ReadingSessionService({ logger: silent, idleTimeoutMs: 90_000 });
  const session = sessions.open({ location: 'livingroom', learnerId: 'test-learner' });
  expect(session.idleTimeoutMs).toBe(90_000);
});
```

**Step 2: Run, expect FAIL** (`undefined`).

**Step 3: Implement** — add one field to the frozen object in `open()`:

```javascript
      // Published so the launch card can DRAW the window it is being judged
      // against. A constant duplicated in the frontend drifts the first time
      // this is tuned, and the screen would then lie about how long a child has.
      idleTimeoutMs: this.#idleTimeoutMs,
```

**Step 4: Run the file. Expected: PASS.**

**Step 5: Commit**

```bash
git commit -am "feat(reading): the session publishes its own idle window"
```

---

## Task 5: Verify Phase 1 against the field

**No code.** After deploying, confirm in the log store that the seam actually fires:

```bash
curl -s https://logs.kckern.net/select/logsql/query \
  -d 'query="school.reading.session-reopened" AND _time:7d' -d 'limit=50'
```

Also confirm the bad pattern has stopped — a `session-timeout` followed within a minute by a `wake-and-load.playback.confirmed` with no `session-reopened` between them is the original defect recurring.

---

# Phase 2 — Correctness bugs (frontend, independent)

## Task 6: The weekday label is off by one

**Files:**
- Modify: `frontend/src/modules/School/reading/ReadingSessionScreen.jsx:197-205`
- Test: `frontend/src/modules/School/reading/ReadingSessionScreen.test.jsx`

`recentDayLabel` builds the date at **UTC** midnight and formats the weekday in **local** time. West of Greenwich that is always the previous day. The live summary returned `2026-09-09` (Wednesday) and `2026-09-08` (Tuesday); the screen read **TUE** and **MON** — and contradicted the streak wall directly below it, which had the counts on the right days.

**Step 1: Export the function and write the failing test**

Change the declaration to `export function recentDayLabel(...)`, add it to the test file's import, and append:

```javascript
describe('recentDayLabel', () => {
  it('names the weekday of the study day itself, not the day before it', () => {
    // 2026-09-09 is a Wednesday. Parsed at UTC midnight and formatted in any
    // timezone west of Greenwich, the naive version said "Tue".
    expect(recentDayLabel('2026-09-09', '2026-09-11')).toBe('Wed');
    expect(recentDayLabel('2026-09-08', '2026-09-11')).toBe('Tue');
  });

  it('still prefers the words for the two days that have them', () => {
    expect(recentDayLabel('2026-09-11', '2026-09-11')).toBe('Today');
    expect(recentDayLabel('2026-09-10', '2026-09-11')).toBe('Yesterday');
  });
});
```

**Step 2: Run, expect FAIL** — `expected 'Tue' to be 'Wed'`.

```bash
npx vitest run frontend/src/modules/School/reading/ReadingSessionScreen.test.jsx -t recentDayLabel
```

**Step 3: Implement**

```javascript
export function recentDayLabel(studyDay, currentStudyDay) {
  if (!studyDay) return '';
  if (studyDay === currentStudyDay) return 'Today';
  const current = Date.parse(`${currentStudyDay}T00:00:00Z`);
  const day = Date.parse(`${studyDay}T00:00:00Z`);
  if (Number.isFinite(current) && current - day === 86_400_000) return 'Yesterday';
  if (!Number.isFinite(day)) return studyDay;
  // FORMATTED IN UTC, BECAUSE IT WAS PARSED IN UTC. A study day is a calendar
  // date, not an instant; handing `new Date(utcMidnight)` to a local-time
  // formatter shifts it a day backwards anywhere west of Greenwich, which put
  // Wednesday's two books under a heading that read TUE — while the streak
  // wall six inches below had them on the right day.
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' }).format(new Date(day));
}
```

**Step 4: Run. Expected: PASS.**

**Step 5: Commit**

```bash
git commit -am "fix(reading): the shelf's weekday label names the right day"
```

---

## Task 7: Covers are requested at the size they are drawn

**Files:**
- Modify: `frontend/src/modules/School/plexImage.js:59-66` (add a box)
- Modify: `frontend/src/modules/School/reading/bookCovers.js:40-46`
- Test: `frontend/src/modules/School/reading/bookCovers.test.js`

`bookCovers.js` returns `data.image` untouched — the raw proxied original (`/api/v1/proxy/plex/library/metadata/620705/thumb/…`). Library originals measured 640×640 to 1336×1920; the shelf draws ~102 CSS px on a panel running dpr 2. That is a 3–9× browser bilinear downscale, varying per poster, which is the blocky/uneven look. `sizedPlexImage` already exists for exactly this and its own header documents the same "some covers smooth, some abysmal" split — the reading shelf is the surface not using it.

**Step 1: Write the failing test**

```javascript
it('asks Plex for the shelf-sized image rather than the original poster', async () => {
  const fetchImpl = vi.fn(async () => ({
    ok: true, json: async () => ({ image: '/api/v1/proxy/plex/library/metadata/620705/thumb/1779295360' }),
  }));
  const url = await bookCover('plex:620707', fetchImpl);
  expect(url).toContain('/photo/:/transcode');
  expect(url).toContain('width=');
});

it('leaves a non-Plex cover exactly as it arrived', async () => {
  const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ image: '/img/local-cover.jpg' }) }));
  expect(await bookCover('plex:620999', fetchImpl)).toBe('/img/local-cover.jpg');
});
```

Remember `bookCovers.js` caches process-wide and forever — call `__resetBookCovers()` in a `beforeEach`.

**Step 2: Run, expect FAIL** — the raw thumb URL comes back.

**Step 3: Implement**

Add to `ART_BOX` in `plexImage.js`:

```javascript
  readingShelf: [205, 205],  // .reading-session__recent-card cover, aspect-ratio 1 (square sleeves)
```

Then in `bookCovers.js`, import it and size the result inside `lookup`:

```javascript
import { sizedPlexImage, ART_BOX } from '../plexImage.js';

// …inside lookup(), replacing the bare return:
  const raw = data?.image ?? data?.thumbnail ?? data?.imageUrl ?? null;
  return sizedPlexImage(raw, ...ART_BOX.readingShelf);
```

Extend the module header to say why — the shelf is square sleeves and the box is square, so no crop; the point is the resample.

**Step 4: Run**

```bash
npx vitest run frontend/src/modules/School/reading/bookCovers.test.js
```
Expected: PASS, including the pre-existing dedup/sequencing tests.

**Step 5: Commit**

```bash
git add frontend/src/modules/School/plexImage.js frontend/src/modules/School/reading/bookCovers.js frontend/src/modules/School/reading/bookCovers.test.js
git commit -m "fix(reading): request shelf covers at the size they are drawn"
```

---

## Task 8: The learner's name

**Files:**
- Investigate: `backend/src/3_applications/school/ReadingApiService.mjs` (`summary`)
- Modify: `frontend/src/modules/School/reading/ReadingSessionScreen.jsx:625-628`

The live summary returned `displayName: null` for the learner, so `<h2 className="reading-session__name">` never rendered and the header was an unlabeled portrait.

**Step 1:** Determine whether this is data or code:

```bash
curl -s "http://10.0.0.10:3111/api/v1/school/reading/summary?learnerId=<learner-id>" | head -c 300
grep -n "displayName" backend/src/3_applications/school/ReadingApiService.mjs
```

**Step 2:** If the household roster has a name and `summary` drops it, fix it there and add a test. If the roster genuinely has none, that is a data fix — record it and move on; **do not** invent a frontend fallback that prints a raw learner id at 5vh to a child who cannot read. Leaving the portrait unlabeled beats printing an id.

**Step 3: Commit** whatever the answer turns out to be, including "no change, roster data" as a note in the plan's Notes section below.

---

# Phase 3 — The today card

The screen is a **view**. Input is the card reader; the TV never receives a touch, a cursor or a focus ring. So the card has three jobs — whose turn it is, what is owed, where the next book goes — and every element must earn its place against those.

## Task 9: Today is always a column, with one slot per book owed

**Files:**
- Modify: `frontend/src/modules/School/reading/ReadingSessionScreen.jsx:258-286` (`RecentDay`, `Recent`) and `:630-640` (the `open` view)
- Test: `frontend/src/modules/School/reading/ReadingSessionScreen.test.jsx`

Today's group is currently absent whenever nothing has been read — `RecentDay` returns `null` on zero books, which is why the screenshot's leftmost column was a past day. The obligation is already in the summary (`target`, `count`, `studyDay`), so today's column can be built client-side with **no API change**.

**Step 1: Write the failing test**

```javascript
it('open: today leads the shelf with an empty, waiting slot for each story owed', async () => {
  vi.stubGlobal('fetch', stubFetch({
    summary: { ...SUMMARY, count: 0, target: 2, studyDay: '2026-09-03', recentDays: SUMMARY.recentDays },
  }));
  render(<ReadingSessionScreen />);
  await deliver({ event: 'session-open', learnerId: 'user_5', location: 'livingroom' });

  const shelf = await screen.findByTestId('reading-recent');
  const days = within(shelf).getAllByTestId('reading-recent-day');
  // Today leads, even with nothing read yet.
  expect(days[0]).toHaveTextContent('Today');
  // Two owed, none read: two empty slots.
  expect(within(days[0]).getAllByTestId('reading-slot')).toHaveLength(2);
  // Exactly ONE of them is the live one — the next book goes there.
  expect(within(days[0]).getAllByTestId('reading-slot')
    .filter((n) => n.className.includes('--live'))).toHaveLength(1);
});

it('open: a story already read today fills a slot and leaves the rest waiting', async () => {
  vi.stubGlobal('fetch', stubFetch({ summary: { ...SUMMARY, count: 1, target: 2 } }));
  render(<ReadingSessionScreen />);
  await deliver({ event: 'session-open', learnerId: 'user_5', location: 'livingroom' });

  const today = (await screen.findAllByTestId('reading-recent-day'))[0];
  expect(within(today).getAllByTestId('reading-recent-card')).toHaveLength(1);
  expect(within(today).getAllByTestId('reading-slot')).toHaveLength(1);
});

it('open: a finished day shows today with no slot at all', async () => {
  vi.stubGlobal('fetch', stubFetch({ summary: { ...SUMMARY, count: 2, target: 2, doneToday: true } }));
  render(<ReadingSessionScreen />);
  await deliver({ event: 'session-open', learnerId: 'user_5', location: 'livingroom' });
  const today = (await screen.findAllByTestId('reading-recent-day'))[0];
  expect(within(today).queryByTestId('reading-slot')).toBeNull();
});
```

**Step 2: Run, expect FAIL** — no `reading-slot` testid exists.

**Step 3: Implement**

Add the slot component above `RecentDay`:

```jsx
/**
 * WHERE THE NEXT BOOK GOES — and the whole reason this screen has an answer.
 *
 * The panel is a VIEW: no touch, no cursor, no focus. A child answers "what do
 * you want to read today?" by scanning a book, so the answer on screen has to
 * be a place, not a control. This is a book-shaped gap in the shelf, recessed
 * and lit from behind — never a bordered tile, never a lift on hover, nothing
 * that has ever been pressed.
 *
 * ONE slot per story still owed, and only the FIRST of them breathes: the same
 * "this is the one you are filling next" the pips drew with their live ring.
 */
function EmptySlot({ live }) {
  return (
    <li
      className={`reading-session__recent-card reading-session__slot${live ? ' reading-session__slot--live' : ''}`}
      data-testid="reading-slot"
    >
      <div className="reading-session__recent-cover reading-session__slot-well" aria-hidden="true" />
      <span className="reading-session__recent-title" />
    </li>
  );
}
```

`RecentDay` takes `slots` and stops bailing when a day is empty but owed:

```jsx
function RecentDay({ group, studyDay, slots = 0 }) {
  const books = (group?.books ?? []).filter((b) => b?.title);
  if (books.length === 0 && slots === 0) return null;
  return (
    <section className="reading-session__recent-day-group" data-testid="reading-recent-day">
      <h4 className="reading-session__recent-day">{recentDayLabel(group.studyDay, studyDay)}</h4>
      <ul className="reading-session__recent-list" data-count={books.length + slots}>
        {books.map((read, index) => (
          <RecentBook key={`${read.contentId ?? read.title ?? 'book'}-${index}`} read={read} />
        ))}
        {Array.from({ length: slots }, (_, i) => <EmptySlot key={`slot-${i}`} live={i === 0} />)}
      </ul>
    </section>
  );
}
```

`Recent` puts today first and computes the slots:

```jsx
/**
 * The shelf: today, then the days behind it.
 *
 * TODAY IS ALWAYS DRAWN, even empty — it is the only column the child can act
 * on, and it used to vanish on the exact day it mattered (`RecentDay` returned
 * null at zero books), leaving a past day sitting where the eye lands first.
 *
 * The slot count comes from the obligation, which is known before a single
 * cover has loaded — so the shelf's geometry is settled at first paint and
 * covers landing one by one never move it.
 */
function Recent({ days, studyDay, target = null, count = 0 }) {
  const groups = (Array.isArray(days) ? days : [])
    .filter((g) => Array.isArray(g?.books) && g.books.some((b) => b?.title));
  const todayGroup = groups.find((g) => g.studyDay === studyDay) ?? { studyDay, books: [] };
  const past = groups.filter((g) => g.studyDay !== studyDay);
  const owed = Number.isFinite(target) ? target : 0;
  const done = Number.isFinite(count) ? count : 0;
  const slots = Math.max(0, owed - done);
  if (slots === 0 && groups.length === 0) return null;
  return (
    <section className="reading-session__recent" data-testid="reading-recent" aria-label="Recent stories">
      <div className="reading-session__recent-days">
        <RecentDay group={todayGroup} studyDay={studyDay} slots={slots} />
        {past.map((group) => (
          <RecentDay key={group.studyDay} group={group} studyDay={studyDay} />
        ))}
      </div>
    </section>
  );
}
```

And the call site in the `open` view:

```jsx
          <Recent
            days={summary?.recentDays}
            studyDay={summary?.studyDay}
            target={summary?.target}
            count={summary?.count}
          />
```

**Step 4: Run**

```bash
npx vitest run frontend/src/modules/School/reading/ReadingSessionScreen.test.jsx
```
Expected: the three new tests PASS. The pre-existing `open:` test asserting `getAllByTestId('reading-recent-day')).toHaveLength(2)` will now fail — today is a third column. Update its expectation and its comment to describe the new shape; do not delete it.

**Step 5: Commit**

```bash
git add frontend/src/modules/School/reading/ReadingSessionScreen.jsx frontend/src/modules/School/reading/ReadingSessionScreen.test.jsx
git commit -m "feat(reading): today always leads the shelf, with a slot per story owed"
```

---

## Task 10: The slot looks like a gap, and breathes

**Files:**
- Modify: `frontend/src/modules/School/reading/ReadingSessionScreen.scss` (after `.reading-session__recent-spine`, ~line 284)

No test — this is appearance. Verify with Task 14's screenshot.

**Step 1: Write the styles**

```scss
/* ── The waiting slot ──────────────────────────────────────────────────────
   A GAP IN THE SHELF, NOT A CONTROL. This panel is a view: it takes no touch
   and shows no cursor, so the one thing a child can act on must read as a
   PLACE — the space a book is missing from — and never as something to press.

   That rules out the whole button vocabulary: no outline, no raised edge, no
   lift, no scale. What is left is the hole: the shelf's own dark, an inner
   shadow deep enough to sit BELOW the plank line, and a light behind it. */
.reading-session__slot-well {
  background: rgba(11, 16, 23, 0.72);
  /* Inset only — the covers beside it carry outer shadows, and an outer shadow
     here would lift the hole off the shelf it is supposed to be part of. */
  box-shadow:
    inset 0 0.6vh 1.4vh rgba(0, 0, 0, 0.78),
    inset 0 0 0 1px rgba(246, 242, 232, 0.05);

  /* The sheen the real covers wear belongs to a surface; a gap has none. */
  &::before { content: none; }
}

/* THE ONE ANIMATION ON THE SCREEN. Slow — 2.4s, about a resting breath — and
   it glows from BEHIND the opening rather than pulsing the shape itself: a
   throb on the outline would read as a button demanding a press, which is the
   one thing this must never say. */
.reading-session__slot--live .reading-session__slot-well {
  animation: reading-slot-breathe 2.4s ease-in-out infinite;
}

@keyframes reading-slot-breathe {
  0%, 100% {
    box-shadow:
      inset 0 0.6vh 1.4vh rgba(0, 0, 0, 0.78),
      inset 0 0 0 1px rgba(255, 212, 121, 0.10),
      inset 0 -1.6vh 2.4vh -1vh rgba(255, 212, 121, 0.12);
  }
  50% {
    box-shadow:
      inset 0 0.6vh 1.4vh rgba(0, 0, 0, 0.78),
      inset 0 0 0 1px rgba(255, 212, 121, 0.26),
      inset 0 -1.6vh 2.4vh -1vh rgba(255, 212, 121, 0.42);
  }
}

/* Motion is the message here, so when motion is refused the message has to
   survive without it: the lit state, held still. */
@media (prefers-reduced-motion: reduce) {
  .reading-session__slot--live .reading-session__slot-well {
    animation: none;
    box-shadow:
      inset 0 0.6vh 1.4vh rgba(0, 0, 0, 0.78),
      inset 0 0 0 1px rgba(255, 212, 121, 0.26),
      inset 0 -1.6vh 2.4vh -1vh rgba(255, 212, 121, 0.42);
  }
}
```

**Step 2: Commit**

```bash
git commit -am "feat(reading): the waiting slot reads as a gap in the shelf"
```

---

## Task 11: The pips leave this screen

**Files:**
- Modify: `frontend/src/modules/School/reading/ReadingSessionScreen.jsx:631-636`
- Test: `frontend/src/modules/School/reading/ReadingSessionScreen.test.jsx`

The slots now say what the pips said, in the notation the child is already looking at. Two notations for one fact, a few hundred pixels apart, is one too many — and on a one-story day the pips degenerate to a single hollow ring under the headline that reads as a loading spinner.

**Keep `ReadingPips.jsx` and `pips.scss`.** The surround rail and both ceremony tiers still use them, and the component's whole argument is that those three acts share one object.

**Step 1: Change the test**

Replace the pip assertions in the `open:` test with a comment explaining the move, and assert absence:

```javascript
    // The obligation is the SLOTS now — the empty places on today's shelf.
    // The pips said the same thing in a second notation a few hundred pixels
    // away, and on a one-story day a single hollow ring reads as a spinner.
    // They survive in the rail and in the ceremony, where nothing else counts.
    expect(screen.queryByTestId('reading-count')).toBeNull();
```

**Step 2: Run, expect FAIL** — the pips are still rendered.

**Step 3: Implement** — delete the `<ReadingPips …/>` element from the `open` view only. Leave the `import`, since `ReadingStage` and `Ceremony` still use it; if the linter says otherwise, verify with `grep -n 'ReadingPips' frontend/src/modules/School/reading/ReadingSessionScreen.jsx` before removing anything.

Delete the now-unused `.reading-session__pips` block from the SCSS.

**Step 4: Run the file. Expected: PASS.**

**Step 5: Commit**

```bash
git commit -am "refactor(reading): the shelf's empty slots replace the launch card's pips"
```

---

## Task 12: The idle clock is visible

**Files:**
- Modify: `frontend/src/modules/School/reading/useReadingSession.js` (expose `idleTimeoutMs` from the session payload)
- Modify: `frontend/src/modules/School/reading/ReadingSessionScreen.jsx` (the `open` view)
- Modify: `frontend/src/modules/School/reading/ReadingSessionScreen.scss`
- Test: `frontend/src/modules/School/reading/ReadingSessionScreen.test.jsx`

Nothing on this screen says a clock is running. It closed silently at 2m15s and cost a real child his credit. The picking view has a countdown bar and the winding-down view has one; the single view where the timeout costs something has nothing. The slot's own light is the honest place for it on a display nobody touches — it goes out as the window runs down.

**Step 1: Write the failing test**

```javascript
it('open: the waiting slot carries the idle window, so the clock is visible', async () => {
  render(<ReadingSessionScreen />);
  await deliver({
    event: 'session-open', learnerId: 'user_5', location: 'livingroom', idleTimeoutMs: 120_000,
  });
  const slot = (await screen.findAllByTestId('reading-slot'))[0];
  expect(slot.style.getPropertyValue('--slot-idle-ms')).toBe('120000');
});
```

**Step 2: Run, expect FAIL.**

**Step 3: Implement**

- In `useReadingSession.js`, carry `idleTimeoutMs` off the `session-open` payload into the returned session state, defaulting to `null`.
- Pass it down `Recent` → `RecentDay` → `EmptySlot`, and on the live slot set `style={{ '--slot-idle-ms': idleTimeoutMs }}` plus a `reading-session__slot--timed` class.
- In SCSS, a second animation on the live slot that runs **once**, `animation-duration: calc(var(--slot-idle-ms, 120000) * 1ms)`, `animation-fill-mode: forwards`, easing the amber down to nothing. Pair it with the breathe animation (two comma-separated animations on one element) so the slot keeps breathing while the light fades.

Add a comment stating plainly that this is a *display* of the backend's clock and never the clock itself — the sweep is authoritative and the CSS is a picture of it.

**Step 4: Run. Expected: PASS.**

**Step 5: Commit**

```bash
git commit -am "feat(reading): the waiting slot shows the idle window running down"
```

---

## Task 13: The streak wall leaves the waiting screen

**Files:**
- Modify: `frontend/src/modules/School/reading/ReadingSessionScreen.jsx:638-640`
- Test: `frontend/src/modules/School/reading/ReadingSessionScreen.test.jsx`

Eight states (`met` / `partial` / `none` / `exempt` / `rest` / `unknown` / `future` / `unknown-met`) encoded as colour with no key, no weekday header, and a ragged first row where the month starts mid-week. It is also the heaviest thing on screen after the covers, competing with the one element the child is meant to act on. `StreakWall`'s own header says a streak wall is for lingering over — and the waiting screen is the one screen nobody should linger on.

**Step 1: Assert it is gone from `open` and still present in the ceremony**

```javascript
it('open: no streak wall — the waiting screen has one job', async () => {
  render(<ReadingSessionScreen />);
  await deliver({ event: 'session-open', learnerId: 'user_5', location: 'livingroom' });
  expect(screen.queryByTestId('reading-streak')).toBeNull();
});
```

The existing ceremony test (`the close is a receipt…`) already asserts `getByTestId('reading-streak')` inside `reading-celebrate` — leave it exactly as it is. That test is what proves the wall moved rather than vanished.

**Step 2: Run, expect FAIL.**

**Step 3: Implement** — delete the `<StreakWall … className="reading-session__streak" />` element and its J7 comment from the `open` view, moving the reasoning into a note at the ceremony's own mount. Delete `.reading-session__streak` from the SCSS. Keep the `StreakWall` import; `Ceremony` uses it.

**Step 4: Run the file. Expected: PASS, ceremony test included.**

**Step 5: Commit**

```bash
git commit -am "refactor(reading): the streak wall belongs to the ceremony, not the wait"
```

---

## Task 14: The case fits the books

**Files:**
- Modify: `frontend/src/modules/School/reading/ReadingSessionScreen.scss:107-120` and `:131-140`

Two measured defects. `.reading-session__recent` is `width: min(80vw, 124vh)` ≈ 1339px while three capped cards occupy ~620px centred — over half the lit case is empty panel. And `padding: 2vh 3vw 0` gives it no bottom, so a two-line title ("I Can Read with My Eyes Shut!") sits flush on the panel's bottom edge.

**Step 1:** Change the panel to shrink to its contents — `width: fit-content; max-width: min(80vw, 124vh);` — and give it a real bottom: `padding: 2vh 3vw 1.6vh;`.

**Step 2: Verify visually.** Do not eyeball this from the code:

```bash
npx playwright test tests/live/flow/ --headed  # or the project's screenshot harness
```

Per `feedback_screenshots_over_code_agents_for_ui_triage`, ask KC for a screenshot of the real panel if the harness cannot reach this screen — it needs a live session, which means a scanned card.

**Step 3: Commit**

```bash
git commit -am "fix(reading): the shelf case fits the books standing in it"
```

---

# Phase 4 — Documentation

## Task 15: Update the reference docs

**Files:**
- Modify: the reading-session behaviour doc named in `ReadingSessionScreen.jsx`'s header (`docs/reference/school/reading-sessions.md` — confirm the path with `ls docs/reference/school/` before editing)
- Modify: `docs/reference/school/reading-log.md`

Cover: the reopen grace and its 45s window; the `content-playing` refusal's new `ownRoom` exemption; the today column and its slots as the obligation's notation; the pips' and streak wall's new homes; the visible idle clock.

Then move this plan out of `_wip/`:

```bash
git mv docs/_wip/plans/2026-09-11-reading-launch-card-and-timeout-race.md docs/_archive/
git rev-parse HEAD > docs/docs-last-updated.txt
git add docs/ && git commit -m "docs(reading): launch card and timeout-race behaviour"
```

---

## Notes for the executor

- **Phase 1 ships alone and is worth shipping first.** It stops a child losing credit; Phase 3 only makes the screen honest about it. Do not bundle them into one deploy if Phase 3 runs long.
- **Never start a second backend.** `node backend/index.js` is a live household controller — a second instance makes real Home Assistant calls and fights the running one for device authority on any port. To run live suites, stop the existing dev server and run one stack.
- **The `open()` return contract matters in Task 2.** It returns the frozen session and broadcasts `session-open`; the test asserts both. If that changes under you, the reopen is what breaks.
- **`bookCovers.js` caches forever, process-wide.** Any test touching it needs `__resetBookCovers()`.
- **Leftover from this session, not in the plan:** The learner's read of "The Three Little Pigs" (`plex:620707`, 2026-09-11) was never credited. `POST /api/v1/school/reading/read` with `{learnerId, contentId, title, location}` records it — the session guards are skipped when no session is open.
