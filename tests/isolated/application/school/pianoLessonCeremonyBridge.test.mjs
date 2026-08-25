/**
 * The bridge's whole job is deciding which lesson completions MEAN something
 * to School. Most piano playing is not schoolwork, and announcing it as if it
 * were teaches the household to ignore the chime — so the negative cases
 * below matter at least as much as the positive one.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { PianoLessonCeremonyBridge } from '#apps/school/PianoLessonCeremonyBridge.mjs';

const COURSE = 'plex:675689';

function fakeBus() {
  const handlers = new Map();
  const sent = [];
  return {
    sent,
    subscribe(topic, fn) {
      handlers.set(topic, fn);
      return () => handlers.delete(topic);
    },
    broadcast(topic, payload) { sent.push({ topic, payload }); },
    async emit(topic, payload) { await handlers.get(topic)?.(payload); },
    get subscribed() { return [...handlers.keys()]; },
  };
}

const assignmentsWith = (programs) => ({ get: async () => ({ programs }) });
const ENROLLED = [{ programId: 'piano-course', courseId: COURSE, subject: 'arts' }];

function build({
  programs = ENROLLED,
  status = { doneToday: true, progressLabel: '12/344', score: 4 },
  hookResult = { ok: true },
} = {}) {
  const bus = fakeBus();
  const fired = [];
  const hook = { fire: async (o) => { fired.push(o); return hookResult; } };
  const bridge = new PianoLessonCeremonyBridge({
    eventBus: bus,
    assignments: assignmentsWith(programs),
    launcher: { id: 'piano-course', status: async () => status },
    hook,
    resolveStudent: async (id) => `${id.toUpperCase()}!`,
    timezone: 'America/Los_Angeles',
    clock: () => new Date('2026-08-25T20:00:00Z'),
    logger: { warn() {}, info() {} },
  });
  bridge.start();
  return { bus, bridge, fired };
}

describe('PianoLessonCeremonyBridge', () => {
  let ctx;
  beforeEach(() => { ctx = build(); });

  it('subscribes to the piano completion topic', () => {
    expect(ctx.bus.subscribed).toContain('piano.lesson.completed');
  });

  it('announces on both limbs when an enrolled learner satisfies the day', async () => {
    await ctx.bus.emit('piano.lesson.completed', { userId: 'felix', title: 'Unit 3 Lesson 7' });

    expect(ctx.bus.sent).toHaveLength(1);
    expect(ctx.bus.sent[0].topic).toBe('school');
    expect(ctx.bus.sent[0].payload).toMatchObject({
      event: 'piano-lesson-complete', learnerId: 'felix', lesson: 'Unit 3 Lesson 7', courseId: COURSE,
    });

    expect(ctx.fired).toHaveLength(1);
    expect(ctx.fired[0]).toMatchObject({
      result: 'satisfied', learnerId: 'felix', subject: 'arts', course: COURSE, lesson: 'Unit 3 Lesson 7',
    });
    // The HA script gets the display name, not the id — it is read aloud or
    // shown on a phone, where "felix" is worse than "FELIX!".
    expect(ctx.fired[0].student).toBe('FELIX!');
  });

  it('fires once per learner per study day, not once per lesson', async () => {
    await ctx.bus.emit('piano.lesson.completed', { userId: 'felix', title: 'one' });
    await ctx.bus.emit('piano.lesson.completed', { userId: 'felix', title: 'two' });
    expect(ctx.fired).toHaveLength(1);
    expect(ctx.bus.sent).toHaveLength(1);
  });

  it('ignores a player with no piano-course enrollment', async () => {
    const c = build({ programs: [{ programId: 'flashcards', deckId: 'x' }] });
    await c.bus.emit('piano.lesson.completed', { userId: 'kckern', title: 'noodling' });
    expect(c.fired).toHaveLength(0);
    expect(c.bus.sent).toHaveLength(0);
  });

  it('stays silent when the completion did not satisfy the day', async () => {
    // e.g. the lesson belonged to a different course than the assigned one.
    const c = build({ status: { doneToday: false, progressLabel: '11/344' } });
    await c.bus.emit('piano.lesson.completed', { userId: 'felix' });
    expect(c.fired).toHaveLength(0);
    expect(c.bus.sent).toHaveLength(0);
  });

  it('does not celebrate an EXCUSED day — nothing was accomplished', async () => {
    const c = build({ status: { doneToday: true, excused: true, progressLabel: 'waiting for milo' } });
    await c.bus.emit('piano.lesson.completed', { userId: 'felix' });
    expect(c.fired).toHaveLength(0);
    expect(c.bus.sent).toHaveLength(0);
  });

  it('stays silent when the course could not be read', async () => {
    const c = build({ status: { error: true } });
    await c.bus.emit('piano.lesson.completed', { userId: 'felix' });
    expect(c.fired).toHaveLength(0);
    expect(c.bus.sent).toHaveLength(0);
  });

  it('still shows the Portal banner when Home Assistant refuses', async () => {
    const c = build({ hookResult: { ok: false, error: 'HA down' } });
    await c.bus.emit('piano.lesson.completed', { userId: 'felix' });
    expect(c.bus.sent).toHaveLength(1);
  });

  it('still shows the Portal banner when the hook throws outright', async () => {
    const bus = fakeBus();
    const bridge = new PianoLessonCeremonyBridge({
      eventBus: bus,
      assignments: assignmentsWith(ENROLLED),
      launcher: { id: 'piano-course', status: async () => ({ doneToday: true }) },
      hook: { fire: async () => { throw new Error('boom'); } },
      clock: () => new Date('2026-08-25T20:00:00Z'),
      logger: { warn() {}, info() {} },
    });
    bridge.start();
    await bus.emit('piano.lesson.completed', { userId: 'felix' });
    expect(bus.sent).toHaveLength(1);
  });

  it('works with no Home Assistant wired at all', async () => {
    const bus = fakeBus();
    const bridge = new PianoLessonCeremonyBridge({
      eventBus: bus,
      assignments: assignmentsWith(ENROLLED),
      launcher: { id: 'piano-course', status: async () => ({ doneToday: true }) },
      hook: null,
      clock: () => new Date('2026-08-25T20:00:00Z'),
      logger: { warn() {}, info() {} },
    });
    bridge.start();
    await bus.emit('piano.lesson.completed', { userId: 'felix' });
    expect(bus.sent).toHaveLength(1);
  });

  it('ignores a payload with no learner', async () => {
    await ctx.bus.emit('piano.lesson.completed', { title: 'orphan' });
    expect(ctx.fired).toHaveLength(0);
  });

  it('stops cleanly, and stop() before start() is safe', () => {
    const bridge = new PianoLessonCeremonyBridge({
      eventBus: fakeBus(),
      assignments: assignmentsWith(ENROLLED),
      launcher: { id: 'piano-course', status: async () => ({}) },
    });
    expect(() => bridge.stop()).not.toThrow();
    bridge.start();
    expect(() => bridge.stop()).not.toThrow();
  });
});
