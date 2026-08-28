// tests/live/flow/school/media-lesson-checkpoint.runtime.test.mjs
//
// THE HARD GATE, IN A REAL BROWSER.
//
// A gated media lesson stops the picture at an authored second and will not
// resume until the child answers. Four things have to be true at once for that
// to work, and every one of them is a property of a real media element under a
// real React tree — none of them can be observed in a unit test:
//
//   1. the element PAUSES when the playhead crosses the checkpoint
//   2. a question is ON SCREEN over the paused picture
//   3. a forward seek past the checkpoint SNAPS BACK to the ceiling
//   4. a graded-correct answer RESUMES playback
//
// The chain under test is entirely production code:
//
//   MediaLessonScreen (widget)      screen-framework registry entry
//     → useMediaLessonSession       the lesson state machine + WS topic
//     → useMediaClockState          the 10 Hz playhead off the element
//     → useCheckpointGate           the school gate AUTHORITY (verdict only)
//     → useMediaGate → mediaGate    ENFORCEMENT: pause + seek clamp
//     → CheckpointQuizOverlay       the question card and its two-tap answer
//
// ── WHY THIS TEST STUBS ITS OWN WORLD, AND WHAT THAT COSTS ───────────────────
//
// Three fixtures this lesson needs do not exist and MUST NOT BE MADE TO EXIST
// on disk:
//
//   * A screen carrying the widget. `data/household/screens/living-room.yml`
//     has `school-reading` but NOT `school-lesson` — by design: per the plan's
//     Task 18, that YAML edit goes live on PROD the moment it is saved, because
//     `data/` is one Dropbox-synced tree shared with production. So the screen
//     config is served from this file (`SCREEN_CONFIG`), and the test asserts
//     against a screen it fully owns.
//   * A unit with a `checkpoints:` block and a bank holding the referenced
//     items. Same hazard, same answer: the snapshot is served from here in
//     exactly the shape `ReadLessonSnapshot` projects — `{id, at, items}` with
//     items as PUBLIC bodies `{id, type, prompt, choices}`.
//   * A dispatched session. `DispatchMedia` runs through DoNow's occupancy and
//     approval ladder and would need a real learner, a real plan and a real
//     room. The screen only ever learns about a lesson from ONE thing — a
//     `lesson.open` payload on the `lesson:{location}` WebSocket topic — so the
//     test delivers exactly that payload, through `wsService._dispatch`.
//
// WHAT IS THEREFORE NOT COVERED HERE, and where it IS covered: the SERVER-side
// half of the gate. `RecordCheckpointAnswer` grading against the bank, and
// `RecordMediaCompletion` refusing `media_completed` while checkpoints are
// outstanding (409), are the hard guarantee — a client that lost its checkpoint
// list still cannot claim the lesson. Those live in
// `backend/src/2_domains/school/mediaCheckpoints.test.mjs` and the use cases'
// own suites. This file is about the half that only a browser can prove: that
// the picture actually stops in front of the child, and actually starts again.
//
// ── THE MEDIA ────────────────────────────────────────────────────────────────
//
// A real lesson resolves to a Plex locator. This test does NOT use one, and
// that is a deliberate trade rather than a convenience:
//
//   * assertion 3 seeks FORWARD 46 seconds. On a live Plex transcode that is a
//     re-mint and a rebuffer, i.e. the flakiest possible way to ask "did the
//     clamp fire"; on a fully-buffered local file it is exact (measured: a seek
//     to 70.0 lands at 70.0).
//   * `?goto=` has to survive to the element. Through Plex it is a server-side
//     offset plus a client-side correction; through a plain <video> it is one
//     `currentTime` write, which is the behaviour the four assertions are about.
//
// So `beforeAll` GENERATES a 90-second VP8/WebM clip with ffmpeg and serves it
// through `page.route` with byte-range support. VP8 (not H.264) because every
// Chromium build ships it, including builds without proprietary codecs — the
// fixture must not become a codec-licensing question. **ffmpeg is a hard
// precondition and its absence FAILS `beforeAll`.** It is not skipped: a run
// that cannot build its own media has proved nothing.
//
// ── PRECONDITIONS (all fail loudly; none skip) ───────────────────────────────
//
//   * `ffmpeg` on PATH — the fixture clip is generated per run.
//   * The ONE dev stack serving the app port (`tests/_lib/configHelper.mjs`
//     SSOT). Only Vite is really needed — every API this page touches is
//     intercepted — but `playwright.config.mjs` reuses an existing server, and
//     per CLAUDE.local.md a SECOND backend must never be started to run this.
//
// Run it with the user's stack already up:
//
//   npx playwright test tests/live/flow/school/media-lesson-checkpoint.runtime.test.mjs --reporter=line

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

// ── the authored lesson ──────────────────────────────────────────────────────

/** A screen id this test owns outright. Its config is served below, never read from `data/`. */
const SCREEN = 'media-lesson-flow-fixture';
/** The widget's room, and therefore its WS topic: `lesson:livingroom`. */
const LOCATION = 'livingroom';
const TOPIC = `lesson:${LOCATION}`;

const SESSION_ID = 'ses_flow_checkpoint';
const CONTENT_ID = 'test:media-lesson-fixture';
const LEARNER = { id: 'test-learner', name: 'Test Learner' };

/** Where the generated clip is served. Nothing real lives at this path. */
const MEDIA_PATH = '/__test-media/media-lesson-fixture.webm';
const MEDIA_SECONDS = 90;

/**
 * `?goto=<seconds>` (lib/Player/reviewParams.js) starts playback at an absolute
 * time and suppresses the saved resume. It is what makes this test take four
 * seconds of playback instead of twenty-four.
 *
 * TWO CONSTRAINTS decide these numbers, both measured in
 * `useCommonMediaController`'s start-time branch:
 *   - `secondsRemaining < 30` silently resets the start to 0, so the clip must
 *     be at least GOTO + 30 long. 90 − 20 = 70. Comfortable.
 *   - the gap GOTO → CP1_AT is how long the test waits for the gate to fire.
 */
const GOTO = 20;
const CP1_AT = 24;
const CP2_AT = 60;

/** The answer the stubbed grader accepts. Deliberately not a substring of any other choice. */
const CORRECT = 'Springfield';
const CP1_PROMPT = 'What is the capital of Illinois?';

/**
 * The ✓ beat, lengthened from its 1200ms default through the seam
 * `MediaLessonScreen` exposes for exactly this. Two reasons, both about
 * evidence rather than convenience: a 1.2s window is a real race for an
 * assertion that the tick appeared at all, and the beat is the window in which
 * "the gate is HELD through the child's own success" is observable. Lengthening
 * it does not weaken anything — the release still has to come from
 * `commitClear`, which still only runs off a reply that said `checkpointCleared`.
 */
const CELEBRATE_MS = 2500;

const CHECKPOINTS = [
  {
    id: `cp-${CP1_AT}`,
    at: CP1_AT,
    items: [{
      id: 'q-illinois-capital',
      type: 'multiple_choice',
      prompt: CP1_PROMPT,
      choices: [CORRECT, 'Chicago', 'Peoria', 'Rockford'],
    }],
  },
  {
    id: `cp-${CP2_AT}`,
    at: CP2_AT,
    items: [{
      id: 'q-illinois-lake',
      type: 'multiple_choice',
      prompt: 'Which Great Lake touches Illinois?',
      choices: ['Lake Michigan', 'Lake Erie', 'Lake Huron', 'Lake Ontario'],
    }],
  },
];

/** The snapshot `GET /api/v1/school/lesson/:sessionId` answers with. */
const SNAPSHOT = {
  sessionId: SESSION_ID,
  learner: LEARNER,
  contentId: CONTENT_ID,
  title: 'Illinois — Regions and States',
  checkpoints: CHECKPOINTS,
  cleared: [],
  resumePosition: null,
  seekCeiling: CP1_AT,
  state: 'media_dispatched',
  playing: true,
};

/**
 * The screen. Deliberately minimal: no screensaver (ArtMode is a FULLSCREEN
 * overlay and would compete for the slot the lesson mounts into), no input
 * adapter, no data sources, no websocket guardrails — nothing that would make
 * this a test of the living room instead of a test of the gate.
 */
const SCREEN_CONFIG = {
  screen: SCREEN,
  route: `/screen/${SCREEN}`,
  layout: {
    children: [
      {
        widget: 'school-lesson',
        grow: 1,
        props: { location: LOCATION, checkpointCelebrateMs: CELEBRATE_MS },
      },
    ],
  },
};

/** One queue item, pre-resolved. `format`+`mediaUrl` take SinglePlayer's direct-play
 *  bypass, so no `/api/v1/play/<id>` round trip happens at all. `mediaType: 'video'`
 *  (not `dash_video`) is what keeps VideoPlayer on the plain `<video src>` branch. */
const QUEUE_RESPONSE = {
  items: [{
    contentId: CONTENT_ID,
    id: CONTENT_ID,
    assetId: CONTENT_ID,
    title: SNAPSHOT.title,
    format: 'video',
    mediaType: 'video',
    mediaUrl: MEDIA_PATH,
    duration: MEDIA_SECONDS,
  }],
  audio: null,
};

// ── the generated clip ───────────────────────────────────────────────────────

let mediaDir = null;
let mediaBytes = null;

test.beforeAll(() => {
  try {
    mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-lesson-media-'));
  } catch (err) {
    throw new Error(`MEDIA LESSON GATE PRECONDITION FAILED: could not make a temp dir (${err.message}).`);
  }
  const out = path.join(mediaDir, 'lesson.webm');
  try {
    execFileSync('ffmpeg', [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', `testsrc=size=320x180:rate=5:duration=${MEDIA_SECONDS}`,
      // VP8/WebM: supported by EVERY Chromium build, so the fixture can never
      // become a proprietary-codec question. `-g 10` = a keyframe every 2s at
      // 5fps, which is what makes the seek assertions land exactly.
      '-c:v', 'libvpx', '-b:v', '80k', '-deadline', 'realtime', '-cpu-used', '8', '-g', '10',
      out,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (err) {
    throw new Error(
      'MEDIA LESSON GATE PRECONDITION FAILED: could not generate the fixture clip with ffmpeg. ' +
      'This gate builds its own media on purpose (see the header) and ffmpeg is a hard requirement — ' +
      `install it, do not skip this test. Underlying error: ${err.stderr?.toString?.().trim() || err.message}`,
    );
  }
  mediaBytes = fs.readFileSync(out);
  if (mediaBytes.length < 10_000) {
    throw new Error(
      `MEDIA LESSON GATE PRECONDITION FAILED: ffmpeg produced ${mediaBytes.length} bytes, ` +
      'which is not a playable 90-second clip.',
    );
  }
});

test.afterAll(() => {
  if (mediaDir) fs.rmSync(mediaDir, { recursive: true, force: true });
});

// ── the stubbed world ────────────────────────────────────────────────────────

/**
 * Serve the clip, honouring `Range`. Chromium usually asks for the whole file
 * for something this small (measured: one request, no Range header), but a
 * media element that decides to range-request and gets a 200 back can end up
 * unable to seek — and this test seeks twice.
 */
async function serveMedia(route) {
  const range = route.request().headers().range;
  const match = /bytes=(\d+)-(\d*)/.exec(range || '');
  if (!match) {
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'video/webm',
        'content-length': String(mediaBytes.length),
        'accept-ranges': 'bytes',
      },
      body: mediaBytes,
    });
    return;
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : mediaBytes.length - 1;
  const slice = mediaBytes.subarray(start, end + 1);
  await route.fulfill({
    status: 206,
    headers: {
      'content-type': 'video/webm',
      'content-length': String(slice.length),
      'accept-ranges': 'bytes',
      'content-range': `bytes ${start}-${end}/${mediaBytes.length}`,
    },
    body: slice,
  });
}

/**
 * `/api/v1/school/lesson/*`, in the shapes `mediaLesson.mjs` documents.
 *
 * The grader is real, not a rubber stamp: `checkpointCleared` comes back only
 * for the right string, so assertion 4 is proving the gate opens on a GRADED
 * reply rather than on the act of answering. `attempts` counts per checkpoint,
 * which is what the overlay's reshuffle-and-nudge behaviour reads.
 */
function installLessonApi(page, state) {
  return page.route('**/api/v1/school/lesson/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (status, body) => route.fulfill({
      status, contentType: 'application/json', body: JSON.stringify(body),
    });

    if (url.pathname.endsWith(`/lesson/${SESSION_ID}`)) {
      state.snapshotReads += 1;
      return json(200, SNAPSHOT);
    }
    if (url.pathname.endsWith('/position')) {
      state.positions += 1;
      return json(200, { ok: true, reported: true });
    }
    if (url.pathname.endsWith('/ended')) {
      return json(200, {
        status: 'completed', sessionId: SESSION_ID, completed: true,
        remaining: 0, seekCeiling: null, nextAction: null, message: null,
      });
    }
    if (url.pathname.endsWith('/answer')) {
      const body = route.request().postDataJSON() || {};
      state.answers.push(body);
      const checkpoint = CHECKPOINTS.find((c) => c.id === body.checkpointId);
      if (!checkpoint) return json(404, { status: 'unknown_checkpoint' });
      const attempts = (state.attempts[checkpoint.id] = (state.attempts[checkpoint.id] ?? 0) + 1);
      // Every checkpoint here has exactly one item, so clearing the item clears
      // the checkpoint — the same collapse `RecordCheckpointAnswer` makes.
      const correct = body.given === checkpoint.items[0].choices[0];
      if (correct) state.cleared.push(checkpoint.id);
      const nextUncleared = CHECKPOINTS.find((c) => !state.cleared.includes(c.id));
      return json(200, {
        status: 'graded',
        correct,
        attempts,
        checkpointCleared: correct,
        seekCeiling: nextUncleared ? nextUncleared.at : null,
        message: null,
      });
    }
    return json(404, { status: 'not_stubbed', path: url.pathname });
  });
}

/** Everything the page needs, and nothing it does not. */
async function installWorld(page, state) {
  await page.route(`**${MEDIA_PATH}`, serveMedia);
  await page.route('**/api/v1/screens/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(SCREEN_CONFIG),
  }));
  await page.route('**/api/v1/queue/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(QUEUE_RESPONSE),
  }));
  await installLessonApi(page, state);
}

/** The lesson's media element, and the two facts every assertion here is about. */
const readMedia = (page) => page.locator('video').first().evaluate((v) => ({
  paused: v.paused,
  currentTime: v.currentTime,
  duration: v.duration,
  readyState: v.readyState,
  error: v.error ? v.error.code : null,
}));

// ── the run ──────────────────────────────────────────────────────────────────

test('a hard-gated media lesson pauses at a checkpoint, clamps a forward seek, and resumes on a correct answer', async ({ page }) => {
  const state = { snapshotReads: 0, positions: 0, answers: [], attempts: {}, cleared: [] };
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err?.message || err)));

  await installWorld(page, state);
  await page.goto(`${FRONTEND_URL}/screen/${SCREEN}?goto=${GOTO}`);

  // The screen has to be alive before a broadcast can reach anything.
  await page.waitForFunction(() => Boolean(window.__wsService), null, { timeout: 20_000 });

  // DISPATCH. The widget renders nothing while idle, so there is no DOM state
  // that says "subscribed yet" — the payload is re-sent until the stage mounts.
  // Re-sending is safe by contract: `useMediaLessonSession` DROPS a repeat of
  // the sessionId it is already running (`school.lesson.open.repeat`).
  await expect.poll(async () => {
    await page.evaluate(([topic, sessionId]) => {
      window.__wsService?._dispatch?.({ topic, type: 'lesson.open', sessionId });
    }, [TOPIC, SESSION_ID]);
    return page.locator('[data-testid="media-lesson-stage"]').count();
  }, {
    message: 'the school-lesson widget never took up the dispatched lesson — '
      + 'no [data-testid="media-lesson-stage"] mounted after lesson.open',
    timeout: 20_000,
    intervals: [250],
  }).toBeGreaterThan(0);

  // ≥1, not ==1: the poll above re-sends `lesson.open` until the stage mounts,
  // and the hook's repeat guard reads a ref written during RENDER — so a resend
  // landing inside the first render window can legitimately re-fetch. How many
  // times the snapshot was read is not what this gate is about; that it was
  // read at all is the premise everything below stands on.
  expect(state.snapshotReads, 'the widget never fetched its lesson snapshot').toBeGreaterThanOrEqual(1);

  // The clip is the one we generated, and `?goto=` landed us just short of the
  // first checkpoint. Asserted before anything else so a broken fixture reads as
  // a broken fixture rather than as a broken gate.
  await expect.poll(async () => (await readMedia(page)).readyState, {
    message: `the lesson media never loaded (page errors: ${JSON.stringify(pageErrors)})`,
    timeout: 30_000,
  }).toBeGreaterThanOrEqual(1);

  const loaded = await readMedia(page);
  expect(loaded.error, 'the media element reported a decode/network error').toBeNull();
  expect(loaded.duration).toBeGreaterThan(MEDIA_SECONDS - 1);
  expect(loaded.duration).toBeLessThan(MEDIA_SECONDS + 1);

  // ── 1. PLAYBACK PAUSES AT THE CHECKPOINT ───────────────────────────────────
  await expect.poll(async () => (await readMedia(page)).paused, {
    message: 'the checkpoint gate never paused the element',
    timeout: 40_000,
    intervals: [200],
  }).toBe(true);

  const atGate = await readMedia(page);
  // `at <= position` is inclusive, so the gate cannot fire early; the pause is
  // applied a React effect later, so it cannot be far late either.
  expect(atGate.currentTime,
    `paused at ${atGate.currentTime}s — the gate must not stop the picture before the authored ${CP1_AT}s`)
    .toBeGreaterThanOrEqual(CP1_AT);
  expect(atGate.currentTime,
    `paused at ${atGate.currentTime}s — far past the authored ${CP1_AT}s, so this pause was not the checkpoint`)
    .toBeLessThan(CP1_AT + 2);

  // ── 2. THE QUESTION IS ON SCREEN ───────────────────────────────────────────
  await expect(page.getByTestId('checkpoint-quiz')).toBeVisible();
  await expect(page.locator('.school-item__prompt')).toHaveText(CP1_PROMPT);
  // Every choice is rendered (the overlay shuffles them, so this is a count and
  // a membership check, never a position check).
  await expect(page.locator('.school-item__choice')).toHaveCount(CHECKPOINTS[0].items[0].choices.length);
  await expect(page.locator('.school-item__choice', { hasText: CORRECT })).toBeVisible();
  // The escape hatch the design guarantees is present for every item type.
  await expect(page.getByTestId('checkpoint-rewind')).toBeVisible();

  // ── 3. A FORWARD SEEK PAST THE CHECKPOINT SNAPS BACK ───────────────────────
  // The ceiling is the first UNCLEARED checkpoint — CP1_AT, since nothing is
  // cleared yet. `mediaGate`'s `seeking` listener rewrites currentTime to it.
  const seekTarget = CP2_AT + 10;
  await page.locator('video').first().evaluate((v, t) => { v.currentTime = t; }, seekTarget);

  await expect.poll(async () => (await readMedia(page)).currentTime, {
    message: `a seek to ${seekTarget}s was not clamped back to the ${CP1_AT}s seek ceiling`,
    timeout: 10_000,
    intervals: [100],
  }).toBeLessThan(CP1_AT + 0.5);

  const afterClamp = await readMedia(page);
  expect(afterClamp.currentTime,
    'the clamp must land ON the ceiling, not rewind past it').toBeGreaterThanOrEqual(CP1_AT - 0.5);
  expect(afterClamp.paused, 'the gate still blocks, so the seek must not have started playback').toBe(true);
  await expect(page.getByTestId('checkpoint-quiz')).toBeVisible();

  // ── 4. A CORRECT ANSWER RESUMES PLAYBACK ───────────────────────────────────
  // MultipleChoiceItem is a two-tap control: the first tap ARMS a choice, the
  // second confirms it. `hasText` (substring) rather than an accessible-name
  // match, because arming appends " — tap again" to the label.
  const correctChoice = page.locator('.school-item__choice', { hasText: CORRECT });
  await correctChoice.click();
  await correctChoice.click();

  await expect.poll(() => state.answers.length, {
    message: 'the overlay never POSTed an answer',
    timeout: 10_000,
  }).toBe(1);
  expect(state.answers[0]).toMatchObject({
    checkpointId: CHECKPOINTS[0].id,
    itemId: CHECKPOINTS[0].items[0].id,
    given: CORRECT,
  });

  // The ✓ beat holds the gate closed on purpose, so the video does not walk out
  // from under the child's own success — and only when it ends does
  // `commitClear` publish the cleared id and open the gate.
  await expect(page.getByTestId('checkpoint-cleared')).toBeVisible();
  expect((await readMedia(page)).paused,
    'the gate must stay closed through the ✓ beat — the picture must not resume under the tick').toBe(true);

  await expect.poll(async () => (await readMedia(page)).paused, {
    message: 'a graded-correct answer did not release the gate — the element is still paused',
    timeout: 15_000,
    intervals: [200],
  }).toBe(false);

  await expect.poll(async () => (await readMedia(page)).currentTime, {
    message: 'the gate released but the playhead never moved past the checkpoint',
    timeout: 15_000,
    intervals: [200],
  }).toBeGreaterThan(CP1_AT + 0.5);

  // The question is gone with the gate, and the next checkpoint has not fired.
  await expect(page.getByTestId('checkpoint-quiz')).toHaveCount(0);
  expect(pageErrors, 'the lesson raised uncaught page errors').toEqual([]);
});
