/**
 * The living-room media lesson's state machine, tested at the four seams that
 * fail INVISIBLY in the field:
 *
 *   1. the HARD GATE stays hard — a failed answer POST clears nothing, and a
 *      "rewind and rewatch" clears nothing either;
 *   2. semantic natural completion is the only completion — `clear` must
 *      never POST /ended;
 *   3. a session that died server-side (410) can never leave a frozen picture
 *      with no way out;
 *   4. attribution is frozen at open — a later snapshot cannot re-credit the
 *      lesson to whoever wandered past while it played.
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ handler: null, topic: null, api: null }));

vi.mock('../../../hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: (topic, cb) => { h.topic = topic; h.handler = cb; },
}));

vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info() {}, debug() {}, warn() {}, error() {} }) }),
}));

vi.mock('../schoolApi.js', () => ({
  schoolApi: {
    lessonSession: (...a) => h.api.lessonSession(...a),
    lessonAnswer: (...a) => h.api.lessonAnswer(...a),
    lessonPosition: (...a) => h.api.lessonPosition(...a),
    lessonEnded: (...a) => h.api.lessonEnded(...a),
  },
}));

import {
  useMediaLessonSession, lessonTopic, HEARTBEAT_MS, CHECKPOINT_CELEBRATE_MS, LESSON_CELEBRATE_MS,
} from './useMediaLessonSession.js';

const CP_A = { id: 'cp-312', at: 312, items: ['q4'] };
const CP_B = { id: 'cp-741', at: 741, items: ['q9'] };

const SNAPSHOT = {
  sessionId: 'sess-1',
  contentId: 'plex:99',
  title: 'Astronomy — Episode 3',
  checkpoints: [CP_A, CP_B],
  cleared: [],
  resumePosition: 0,
  learner: { id: 'learner-c', name: 'Learner C' },
};

const ok = (data, status = 200) => Promise.resolve({ ok: true, status, data });
const bad = (status, data = null) => Promise.resolve({ ok: false, status, data });

function stubApi(over = {}) {
  h.api = {
    lessonSession: vi.fn(() => ok(SNAPSHOT)),
    lessonAnswer: vi.fn(() => ok({
      status: 'graded', correct: true, checkpointCleared: true, attempts: 1, message: 'Right!',
    })),
    lessonPosition: vi.fn(() => ok({ ok: true })),
    lessonEnded: vi.fn(() => ok({ completed: true, remaining: [] })),
    ...over,
  };
  return h.api;
}

async function mountOpen(opts = {}) {
  const rewinds = [];
  const hook = renderHook(() => useMediaLessonSession({
    location: 'livingroom', onRewind: (s, meta) => rewinds.push([s, meta]), ...opts,
  }));
  await act(async () => { h.handler({ type: 'lesson.open', sessionId: 'sess-1', learnerId: 'learner-c' }); });
  return { ...hook, rewinds };
}

/** open → first frame → the playhead reaches the first checkpoint. */
async function mountAtCheckpoint(opts = {}) {
  const hook = await mountOpen(opts);
  await act(async () => { await hook.result.current.notePlaybackStarted(); });
  act(() => { hook.result.current.notePosition(312); });
  act(() => { hook.result.current.noteCheckpointDue(CP_A); });
  return hook;
}

describe('useMediaLessonSession', () => {
  beforeEach(() => {
    h.handler = null; h.topic = null;
    stubApi();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('subscribes to its own room and renders nothing until a lesson is dispatched', () => {
    const { result } = renderHook(() => useMediaLessonSession({ location: 'livingroom' }));
    expect(h.topic).toBe(lessonTopic('livingroom'));
    expect(h.topic).toBe('lesson:livingroom');
    expect(result.current.view).toBe('idle');
    expect(h.api.lessonSession).not.toHaveBeenCalled();
  });

  it('fetches the snapshot on lesson.open and exposes it', async () => {
    const { result } = await mountOpen();
    expect(h.api.lessonSession).toHaveBeenCalledWith('sess-1');
    expect(result.current.view).toBe('open');
    expect(result.current.lesson).toMatchObject({ sessionId: 'sess-1', contentId: 'plex:99', resumePosition: 0 });
    expect(result.current.learner).toMatchObject({ id: 'learner-c', name: 'Learner C' });
    expect(result.current.checkpoints).toEqual([CP_A, CP_B]);
    expect(result.current.clearedIds).toEqual([]);
  });

  it('accepts the reading-broadcaster spelling (`event`) as well as `type`', async () => {
    renderHook(() => useMediaLessonSession({ location: 'livingroom' }));
    await act(async () => { h.handler({ event: 'lesson.open', sessionId: 'sess-9' }); });
    expect(h.api.lessonSession).toHaveBeenCalledWith('sess-9');
  });

  it('a snapshot fetch that fails leaves nothing mounted, with a notice', async () => {
    stubApi({ lessonSession: vi.fn(() => bad(500)) });
    const { result } = await mountOpen();
    expect(result.current.view).toBe('idle');
    expect(result.current.lesson).toBeNull();
    expect(result.current.notice).toMatchObject({ tone: 'error' });
  });

  it('escape at a notice with no lesson behind it just dismisses it', async () => {
    stubApi({ lessonSession: vi.fn(() => bad(410)) });
    const { result } = await mountOpen();
    expect(result.current.notice).toMatchObject({ tone: 'error' });
    let handled;
    act(() => { handled = result.current.escape(); });
    expect(handled).toBe(true);
    expect(result.current.notice).toBeNull();
    expect(result.current.view).toBe('idle');
  });

  // ── heartbeat ────────────────────────────────────────────────────────────
  it('heartbeats the playhead every 15s while playing, and stops at a checkpoint', async () => {
    const { result } = await mountOpen();
    await act(async () => { await result.current.notePlaybackStarted(); });
    expect(result.current.view).toBe('playing');
    // the first frame reports immediately — a resumed lesson heartbeats at 0
    expect(h.api.lessonPosition).toHaveBeenCalledWith('sess-1', 0);

    act(() => { result.current.notePosition(120); });
    await act(async () => { await vi.advanceTimersByTimeAsync(HEARTBEAT_MS + 10); });
    expect(h.api.lessonPosition).toHaveBeenLastCalledWith('sess-1', 120);

    const before = h.api.lessonPosition.mock.calls.length;
    act(() => { result.current.noteCheckpointDue(CP_A); });
    // the gate position is worth one report, then the timer is cleared
    const atGate = h.api.lessonPosition.mock.calls.length;
    expect(atGate).toBe(before + 1);
    await act(async () => { await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 3); });
    expect(h.api.lessonPosition.mock.calls.length).toBe(atGate);
  });

  it('never fabricates a position it was not given', async () => {
    stubApi({ lessonSession: vi.fn(() => ok({ ...SNAPSHOT, resumePosition: null })) });
    const { result } = await mountOpen();
    await act(async () => { await result.current.notePlaybackStarted(); });
    expect(h.api.lessonPosition).toHaveBeenCalledWith('sess-1', undefined);
  });

  it('stops heartbeating when unmounted', async () => {
    const { result, unmount } = await mountOpen();
    await act(async () => { await result.current.notePlaybackStarted(); });
    const before = h.api.lessonPosition.mock.calls.length;
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 4); });
    expect(h.api.lessonPosition.mock.calls.length).toBe(before);
  });

  // ── the checkpoint ───────────────────────────────────────────────────────
  it('opens the question when the gate says a checkpoint is due', async () => {
    const { result } = await mountAtCheckpoint();
    expect(result.current.view).toBe('checkpoint');
    expect(result.current.dueCheckpoint).toEqual(CP_A);
  });

  it('holds the gate blocked through the ✓ beat, then clears it and resumes', async () => {
    const { result } = await mountAtCheckpoint();
    await act(async () => { await result.current.answer('cp-312', 'q4', 'A'); });

    expect(h.api.lessonAnswer).toHaveBeenCalledWith('sess-1', { checkpointId: 'cp-312', itemId: 'q4', given: 'A' });
    expect(result.current.view).toBe('celebrating');
    expect(result.current.celebration).toBe('checkpoint');
    // THE GATE IS STILL BLOCKED: the id is not published until the beat ends,
    // so the video does not resume out from under the ✓.
    expect(result.current.clearedIds).toEqual([]);

    await act(async () => { await vi.advanceTimersByTimeAsync(CHECKPOINT_CELEBRATE_MS + 10); });
    expect(result.current.clearedIds).toEqual(['cp-312']);
    expect(result.current.view).toBe('playing');
    expect(result.current.dueCheckpoint).toBeNull();
  });

  it('the gate re-reporting the SAME checkpoint during the ✓ beat does not re-ask it', async () => {
    const { result } = await mountAtCheckpoint();
    await act(async () => { await result.current.answer('cp-312', 'q4', 'A'); });
    expect(result.current.view).toBe('celebrating');

    // The widget samples the playhead ~10Hz and the id is deliberately NOT
    // published yet, so the gate is still calling this checkpoint due.
    act(() => { result.current.noteCheckpointDue(CP_A); });
    act(() => { result.current.noteCheckpointDue(CP_A); });
    expect(result.current.view).toBe('celebrating');
    expect(result.current.celebration).toBe('checkpoint');

    await act(async () => { await vi.advanceTimersByTimeAsync(CHECKPOINT_CELEBRATE_MS + 10); });
    expect(result.current.view).toBe('playing');
    expect(result.current.clearedIds).toEqual(['cp-312']);
  });

  it('a wrong answer clears nothing and leaves the question up', async () => {
    stubApi({ lessonAnswer: vi.fn(() => ok({ status: 'graded', correct: false, checkpointCleared: false, attempts: 1 })) });
    const { result } = await mountAtCheckpoint();
    let reply;
    await act(async () => { reply = await result.current.answer('cp-312', 'q4', 'B'); });
    expect(reply).toMatchObject({ ok: true, correct: false, checkpointCleared: false });
    expect(result.current.view).toBe('checkpoint');
    expect(result.current.clearedIds).toEqual([]);
  });

  it('an answer POST that FAILS clears nothing — the gate stays blocked — and says so', async () => {
    stubApi({ lessonAnswer: vi.fn(() => bad(500)) });
    const { result } = await mountAtCheckpoint();
    await act(async () => { await result.current.answer('cp-312', 'q4', 'A'); });
    expect(result.current.view).toBe('checkpoint');
    expect(result.current.clearedIds).toEqual([]);
    expect(result.current.dueCheckpoint).toEqual(CP_A);
    expect(result.current.notice).toMatchObject({ tone: 'error' });
  });

  it('escape does NOTHING at a live question and EXITS at the notice', async () => {
    stubApi({ lessonAnswer: vi.fn(() => bad(500)) });
    const { result } = await mountAtCheckpoint();

    let handled;
    act(() => { handled = result.current.escape(); });
    expect(handled).toBe(false);
    expect(result.current.view).toBe('checkpoint');

    await act(async () => { await result.current.answer('cp-312', 'q4', 'A'); });
    act(() => { handled = result.current.escape(); });
    expect(handled).toBe(true);
    expect(result.current.view).toBe('done');
  });

  it('a second answer while one is in flight is dropped', async () => {
    let release;
    stubApi({
      lessonAnswer: vi.fn(() => new Promise((r) => { release = () => r({ ok: true, status: 200, data: { correct: true, checkpointCleared: true } }); })),
    });
    const { result } = await mountAtCheckpoint();
    let second;
    await act(async () => {
      result.current.answer('cp-312', 'q4', 'A');
      second = await result.current.answer('cp-312', 'q4', 'A');
    });
    expect(second).toMatchObject({ ok: false });
    expect(h.api.lessonAnswer).toHaveBeenCalledTimes(1);
    await act(async () => { release(); });
  });

  // ── rewind and rewatch ───────────────────────────────────────────────────
  it('rewind releases the view but NOT the checkpoint, and the gate re-fires on the way back', async () => {
    const { result, rewinds } = await mountAtCheckpoint();
    act(() => { result.current.chooseRewind(); });

    expect(result.current.view).toBe('playing');
    expect(result.current.clearedIds).toEqual([]);   // nothing is cleared by rewinding
    expect(rewinds).toHaveLength(1);
    expect(rewinds[0][0]).toBe(0);                   // no earlier checkpoint: back to the start
    expect(rewinds[0][1]).toMatchObject({ checkpointId: 'cp-312' });
    expect(result.current.dueCheckpoint).toBeNull();  // nothing is left holding the question

    // the playhead returns; the SAME checkpoint must stop it again
    act(() => { result.current.noteCheckpointDue(CP_A); });
    expect(result.current.view).toBe('checkpoint');
  });

  it('rewinds to the previous checkpoint, not to the start, when there is one', async () => {
    const { result, rewinds } = await mountOpen();
    await act(async () => { await result.current.notePlaybackStarted(); });
    act(() => { result.current.noteCheckpointDue(CP_B); });
    act(() => { result.current.chooseRewind(); });
    expect(rewinds[0][0]).toBe(312);
  });

  // ── completion ───────────────────────────────────────────────────────────
  it('credits the lesson on natural completion once, then celebrates and finishes', async () => {
    const { result } = await mountOpen();
    await act(async () => { await result.current.notePlaybackStarted(); });
    await act(async () => { await result.current.notePlaybackCompleted(); });
    await act(async () => { await result.current.notePlaybackCompleted(); });

    expect(h.api.lessonEnded).toHaveBeenCalledTimes(1);
    expect(result.current.view).toBe('celebrating');
    expect(result.current.celebration).toBe('lesson');

    await act(async () => { await vi.advanceTimersByTimeAsync(LESSON_CELEBRATE_MS + 10); });
    expect(result.current.view).toBe('done');
  });

  it('a refused completion says what is still owed instead of celebrating', async () => {
    stubApi({ lessonEnded: vi.fn(() => ok({ completed: false, remaining: ['cp-741'] })) });
    const { result } = await mountOpen();
    await act(async () => { await result.current.notePlaybackStarted(); });
    await act(async () => { await result.current.notePlaybackCompleted(); });
    expect(result.current.view).toBe('done');
    expect(result.current.celebration).toBeNull();
    expect(result.current.notice).toMatchObject({ tone: 'warn', title: 'One question is still waiting' });
  });

  /**
   * THE ROUTER'S ACTUAL SHAPE (`4_api/v1/routers/mediaLesson.mjs`, a978d2576):
   * `remaining: result.outstanding ?? 0` — a COUNT, and the refusal arrives as
   * a 409 CARRYING A FULL BODY. Both halves used to be got wrong here, and the
   * two bugs compounded into the worst possible sentence: a child who owed one
   * question was told the lesson had failed to save.
   */
  it('a 409 refusal carrying a body says what is owed — not that the save failed', async () => {
    stubApi({
      lessonEnded: vi.fn(() => bad(409, {
        status: 'refused', completed: false, remaining: 2, seekCeiling: 741,
      })),
    });
    const { result } = await mountOpen();
    await act(async () => { await result.current.notePlaybackStarted(); });
    await act(async () => { await result.current.notePlaybackCompleted(); });
    expect(result.current.view).toBe('done');
    expect(result.current.celebration).toBeNull();
    expect(result.current.notice).toMatchObject({
      tone: 'warn', title: '2 questions are still waiting',
    });
  });

  it('counts a single outstanding question in the singular', async () => {
    stubApi({ lessonEnded: vi.fn(() => bad(409, { completed: false, remaining: 1 })) });
    const { result } = await mountOpen();
    await act(async () => { await result.current.notePlaybackStarted(); });
    await act(async () => { await result.current.notePlaybackCompleted(); });
    expect(result.current.notice.title).toBe('One question is still waiting');
  });

  /**
   * The other half of the same seam: letting a body-carrying 409 through must
   * NOT turn every failure into a refusal. A 500, or a 409 with nothing in it,
   * is still a lesson that was watched and not written down.
   */
  it('a genuine transport failure still reads as one', async () => {
    stubApi({ lessonEnded: vi.fn(() => bad(500, null)) });
    const { result } = await mountOpen();
    await act(async () => { await result.current.notePlaybackStarted(); });
    await act(async () => { await result.current.notePlaybackCompleted(); });
    expect(result.current.notice).toMatchObject({ tone: 'error', title: "I couldn't save that lesson" });
  });

  it('`clear` is not natural completion — a bail credits nothing', async () => {
    const { result } = await mountOpen();
    await act(async () => { await result.current.notePlaybackStarted(); });
    await act(async () => { await result.current.notePlaybackDismissed(); });
    expect(h.api.lessonEnded).not.toHaveBeenCalled();
    expect(result.current.view).toBe('done');
  });

  it('media that never played says so; a grown-up pressing back does not', async () => {
    const { result } = await mountOpen();
    await act(async () => { await result.current.notePlaybackDismissed(); });
    expect(result.current.notice).toMatchObject({ tone: 'warn' });

    const second = await mountOpen();
    await act(async () => { await second.result.current.notePlaybackStarted(); });
    await act(async () => { await second.result.current.notePlaybackDismissed(); });
    expect(second.result.current.notice).toBeNull();
  });

  it('media ending DURING a ✓ beat still commits the clear and still credits once', async () => {
    const { result } = await mountAtCheckpoint();
    await act(async () => { await result.current.answer('cp-312', 'q4', 'A'); });
    expect(result.current.view).toBe('celebrating');

    await act(async () => { await result.current.notePlaybackCompleted(); });
    expect(result.current.clearedIds).toEqual(['cp-312']);
    expect(h.api.lessonEnded).toHaveBeenCalledTimes(1);
    expect(result.current.celebration).toBe('lesson');

    // the checkpoint beat's timer must not fire over the lesson's own ending
    await act(async () => { await vi.advanceTimersByTimeAsync(CHECKPOINT_CELEBRATE_MS + 10); });
    expect(result.current.view).toBe('celebrating');
  });

  // ── 410: the session died server-side ────────────────────────────────────
  it('a 410 heartbeat ends the lesson and DROPS THE GATE so no picture can freeze', async () => {
    stubApi({ lessonPosition: vi.fn(() => bad(410)) });
    const { result } = await mountAtCheckpoint();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });

    expect(result.current.view).toBe('done');
    expect(result.current.checkpoints).toEqual([]);   // an empty list cannot block
    expect(result.current.dueCheckpoint).toBeNull();
    expect(result.current.notice).toMatchObject({ tone: 'warn' });

    const after = h.api.lessonPosition.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 3); });
    expect(h.api.lessonPosition.mock.calls.length).toBe(after);
  });

  it('a 410 answer ends the lesson rather than re-asking a question nobody can answer', async () => {
    stubApi({ lessonAnswer: vi.fn(() => bad(410)) });
    const { result } = await mountAtCheckpoint();
    await act(async () => { await result.current.answer('cp-312', 'q4', 'A'); });
    expect(result.current.view).toBe('done');
    expect(result.current.checkpoints).toEqual([]);
  });

  it('a 410 on completion finishes quietly — it never claims a lesson it could not record', async () => {
    stubApi({ lessonEnded: vi.fn(() => bad(410)) });
    const { result } = await mountOpen();
    await act(async () => { await result.current.notePlaybackStarted(); });
    await act(async () => { await result.current.notePlaybackCompleted(); });
    expect(result.current.view).toBe('done');
    expect(result.current.celebration).toBeNull();
  });

  // ── a second dispatch ────────────────────────────────────────────────────
  it('LAST DISPATCH WINS: a different lesson replaces the running one', async () => {
    const { result } = await mountOpen();
    await act(async () => { await result.current.notePlaybackStarted(); });
    act(() => { result.current.noteCheckpointDue(CP_A); });
    expect(result.current.view).toBe('checkpoint');

    h.api.lessonSession.mockImplementation(() => ok({
      ...SNAPSHOT, sessionId: 'sess-2', contentId: 'plex:100', learner: { id: 'learner-d', name: 'Learner D' },
    }));
    await act(async () => { h.handler({ type: 'lesson.open', sessionId: 'sess-2', learnerId: 'learner-d' }); });

    expect(result.current.view).toBe('open');
    expect(result.current.lesson).toMatchObject({ sessionId: 'sess-2' });
    expect(result.current.learner).toMatchObject({ id: 'learner-d' });
    expect(result.current.dueCheckpoint).toBeNull();
  });

  it('an answer in flight when the lesson was replaced never writes into the new one', async () => {
    let release;
    stubApi({
      lessonAnswer: vi.fn(() => new Promise((r) => { release = () => r({ ok: true, status: 200, data: { correct: true, checkpointCleared: true } }); })),
    });
    const { result } = await mountAtCheckpoint();
    act(() => { result.current.answer('cp-312', 'q4', 'A'); });

    h.api.lessonSession.mockImplementation(() => ok({ ...SNAPSHOT, sessionId: 'sess-2' }));
    await act(async () => { h.handler({ type: 'lesson.open', sessionId: 'sess-2' }); });
    await act(async () => { release(); });

    expect(result.current.clearedIds).toEqual([]);
    expect(result.current.view).toBe('open');
  });

  it('a repeat broadcast of the SAME session does not yank a playing lesson back, or re-credit it', async () => {
    const { result } = await mountOpen();
    await act(async () => { await result.current.notePlaybackStarted(); });
    const fetches = h.api.lessonSession.mock.calls.length;

    // a re-broadcast whose snapshot names a DIFFERENT child: attribution is
    // frozen at open and must not follow it.
    h.api.lessonSession.mockImplementation(() => ok({ ...SNAPSHOT, learner: { id: 'sibling', name: 'Sibling' } }));
    await act(async () => { h.handler({ type: 'lesson.open', sessionId: 'sess-1', learnerId: 'sibling' }); });

    expect(h.api.lessonSession.mock.calls.length).toBe(fetches);
    expect(result.current.view).toBe('playing');
    expect(result.current.learner).toMatchObject({ id: 'learner-c' });
  });
});
