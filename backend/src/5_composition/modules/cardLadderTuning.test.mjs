import { describe, expect, it, vi } from 'vitest';
import { createCardLadderTuning } from './cardLadderTuning.mjs';

const quiet = { info() {}, warn() {}, debug() {}, error() {} };

// The service is replaced by a fake so the composition's own jobs are what
// is tested: the tuner only with a model, the scheduled tick, the push.
function fakeService() {
  const calls = [];
  let release = null;
  return {
    calls,
    hold() { return new Promise((resolve) => { release = resolve; }); },
    release: () => release?.(),
    pending: vi.fn(async () => [
      { learnerId: 'learner-a', pkg: 'pkg', deckId: 'deck', day: '2026-09-21' },
      { learnerId: 'learner-b', pkg: 'pkg', deckId: 'deck', day: '2026-09-21' },
    ]),
    runFor: vi.fn(async (row) => { calls.push(row.learnerId); return { status: 'on-track' }; }),
    deliverPushes: vi.fn(async () => { calls.push('pushes'); return []; }),
  };
}

function build(over = {}) {
  const captured = {};
  const service = over.service ?? fakeService();
  const scheduler = { every: vi.fn((ms, task) => { captured.interval = ms; captured.task = task; return captured.stop = vi.fn(); }) };
  const handle = createCardLadderTuning({
    firstTick: vi.fn((ms, task) => { captured.firstMs = ms; captured.firstTask = task; return captured.cancelFirst = vi.fn(); }),
    store: {}, assignments: {}, decks: { getFlashcardDeck: async () => ({ title: 'Korean Words' }) }, lexicons: {},
    settings: () => ({}), logger: quiet, scheduler,
    createService: (deps) => { captured.deps = deps; return service; },
    createRuntime: vi.fn(() => ({ execute: vi.fn() })),
    ...over,
  });
  return { handle, captured, service, scheduler };
}

describe('createCardLadderTuning', () => {
  it('returns a stoppable handle; unscheduled, no timer is set', () => {
    const { handle, scheduler } = build();
    expect(typeof handle.stop).toBe('function');
    expect(typeof handle.tick).toBe('function');
    expect(handle.service).toBeTruthy();
    expect(scheduler.every).not.toHaveBeenCalled();
    handle.stop();
  });

  it('scheduled: ticks every 15 minutes and stop clears the timer (also on server close)', () => {
    const server = { once: vi.fn() };
    const { handle, captured } = build({ scheduled: true, server });
    expect(captured.interval).toBe(15 * 60000);
    // A first tick shortly after boot, so a restart past 4am does not wait 15 min.
    expect(captured.firstMs).toBe(60000);
    expect(captured.firstTask).toBe(handle.tick);
    expect(server.once).toHaveBeenCalledWith('close', handle.stop);
    handle.stop();
    expect(captured.stop).toHaveBeenCalled();
    expect(captured.cancelFirst).toHaveBeenCalled();
  });

  it('builds the tuner only when a model is configured', () => {
    const off = build();
    expect(off.captured.deps.tuner).toBeNull();
    const createRuntime = vi.fn(() => ({ execute: vi.fn() }));
    const on = build({ model: 'openai/gpt-4o-mini', createRuntime });
    expect(on.captured.deps.tuner).not.toBeNull();
    expect(typeof on.captured.deps.tuner.tune).toBe('function');
    expect(createRuntime).toHaveBeenCalledWith(expect.objectContaining({ model: 'openai/gpt-4o-mini' }));
  });

  it('qualifies a bare model id as OpenAI and leaves a provider-qualified id alone', () => {
    const bare = vi.fn(() => ({ execute: vi.fn() }));
    build({ model: 'gpt-5-nano', createRuntime: bare });
    expect(bare).toHaveBeenCalledWith(expect.objectContaining({ model: 'openai/gpt-5-nano' }));
    const qualified = vi.fn(() => ({ execute: vi.fn() }));
    build({ model: 'anthropic/x', createRuntime: qualified });
    expect(qualified).toHaveBeenCalledWith(expect.objectContaining({ model: 'anthropic/x' }));
  });

  it('a tick runs pending() rows one at a time, and a tick during a tick is skipped', async () => {
    const service = fakeService();
    let inFlight = 0; let maxInFlight = 0;
    service.runFor = vi.fn(async (row) => {
      inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1; service.calls.push(row.learnerId);
    });
    const { handle } = build({ service });
    const first = handle.tick();
    await handle.tick(); // overlapping tick: skipped
    await first;
    expect(service.pending).toHaveBeenCalledTimes(1);
    // Tuning first, then the outstanding concern pushes.
    expect(service.calls).toEqual(['learner-a', 'learner-b', 'pushes']);
    expect(maxInFlight).toBe(1);
  });

  it('one learner\'s failure does not stop the tick', async () => {
    const service = fakeService();
    service.runFor = vi.fn(async (row) => { if (row.learnerId === 'learner-a') throw new Error('boom'); service.calls.push(row.learnerId); });
    const { handle } = build({ service });
    await handle.tick();
    expect(service.calls).toEqual(['learner-b', 'pushes']);
  });

  it('notify answers suppressed when quiet hours held every copy, failed when none went out', async () => {
    const send = vi.fn(async () => [{ delivered: false, suppressed: true, reason: 'quiet_hours', channel: null }]);
    const { captured } = build({ notificationService: { send }, teachers: () => ['grown-up-1'] });
    const row = { learnerId: 'user_4', package: 'lang-basics', deckId: 'deck', day: '2026-09-21', status: 'concern', notes: [] };
    expect(await captured.deps.notify(row)).toEqual({ status: 'suppressed' });
    send.mockResolvedValue([{ delivered: false, channel: 'push', error: 'x' }]);
    expect(await captured.deps.notify(row)).toEqual({ status: 'failed' });
    const none = build({ notificationService: { send }, teachers: () => [] });
    expect(await none.captured.deps.notify(row)).toEqual({ status: 'failed', error: 'no teachers configured' });
  });

  it('a concern pushes each teacher with the push-standard copy and data block', async () => {
    const send = vi.fn(async () => [{ delivered: true }]);
    const { captured } = build({
      notificationService: { send }, teachers: () => ['grown-up-1', 'grown-up-2'],
      learnerName: async () => 'Learner4',
    });
    expect(await captured.deps.notify({ learnerId: 'user_4', package: 'lang-basics', deckId: 'deck', day: '2026-09-21', status: 'concern', notes: ['Credited with no words quizzed.'] }))
      .toEqual({ status: 'sent' });
    expect(send).toHaveBeenCalledTimes(2);
    const intent = send.mock.calls[0][0];
    expect(intent).toMatchObject({
      title: '🔤 Learner4 — Korean Words', body: 'Credited with no words quizzed · Mon Sep 21',
      category: 'school', urgency: 'high',
      metadata: { username: 'grown-up-1', pushData: { tag: 'school-user_4-card-ladder-lang-basics', channel: 'School needs you' } },
      dedupeKey: 'card-ladder-concern:grown-up-1:user_4:lang-basics:2026-09-21',
    });
  });

  it('a failing label lookup still pushes, without the label', async () => {
    const send = vi.fn(async () => []);
    const { captured } = build({
      notificationService: { send }, teachers: () => ['grown-up-1'],
      learnerName: async () => { throw new Error('no roster'); },
      decks: { getFlashcardDeck: async () => { throw new Error('no deck'); } },
    });
    await captured.deps.notify({ learnerId: 'user_4', package: 'lang-basics', deckId: 'deck', day: '2026-09-21', status: 'concern', notes: [] });
    expect(send.mock.calls[0][0].title).toBe('🔤 Word practice');
  });

  it('no notification service: notify is null', () => {
    expect(build().captured.deps.notify).toBeNull();
  });
});
