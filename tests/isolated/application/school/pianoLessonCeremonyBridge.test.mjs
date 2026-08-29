/**
 * The bridge's whole job is deciding which lesson completions MEAN something
 * to School. Most piano playing is not schoolwork, and announcing it as if it
 * were teaches the household to ignore the chime — so the negative cases
 * below matter at least as much as the positive one.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { PianoLessonCeremonyBridge } from '#apps/school/PianoLessonCeremonyBridge.mjs';
import { EventBusSchoolRealtimeAdapter } from '#adapters/eventbus/EventBusSchoolRealtimeAdapter.mjs';
import { validateLearningEvidence } from '#domains/school/progress/index.mjs';

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
const completion = (id = 'plex:9001', title = 'Unit 3 Lesson 7') => ({
  course: { id: COURSE, title: 'Hoffman Academy' },
  unit: { id: 'plex:season:3', title: 'Unit 3', position: 3 },
  lesson: { id, title, position: 7 },
  completedAt: '2026-08-25T18:00:00.000Z',
});

function build({
  programs = ENROLLED,
  status = {
    doneToday: true, progressLabel: '12/344', score: 4,
    completedLessonsToday: [completion(), completion('plex:9002', 'Unit 3 Lesson 8')],
    completedLessons: [completion(), completion('plex:9002', 'Unit 3 Lesson 8')],
  },
  hookResult = { ok: true },
} = {}) {
  const bus = fakeBus();
  const fired = [];
  const evidence = [];
  const hook = { fire: async (o) => { fired.push(o); return hookResult; } };
  const bridge = new PianoLessonCeremonyBridge({
    realtime: new EventBusSchoolRealtimeAdapter({ eventBus: bus }),
    assignments: assignmentsWith(programs),
    launcher: { id: 'piano-course', status: async () => status },
    evidenceRepository: { appendEvidence: async (row) => { evidence.push(row); return { status: 'recorded', evidence: row }; } },
    hook,
    resolveStudent: async (id) => `${id.toUpperCase()}!`,
    timezone: 'America/Los_Angeles',
    clock: () => new Date('2026-08-25T20:00:00Z'),
    logger: { warn() {}, info() {} },
  });
  bridge.start();
  return { bus, bridge, fired, evidence };
}

describe('PianoLessonCeremonyBridge', () => {
  let ctx;
  beforeEach(() => { ctx = build(); });

  it('subscribes to the piano completion topic', () => {
    expect(ctx.bus.subscribed).toContain('piano.lesson.completed');
    expect(ctx.bus.subscribed).toContain('piano.school-challenge.completed');
  });

  it('re-derives and announces a configured PianoChallenge completion', async () => {
    const c = build({ status: {
      doneToday: true, challengeCompleted: true, progressLabel: 'Done today', score: 4,
      servedWork: [{ unitId: 'plex:season:3', title: 'Unit 3 Lesson 7' }],
    } });
    await c.bus.emit('piano.school-challenge.completed', {
      userId: 'learner4', descriptorId: 'unit-3-c-major', completedAt: '2026-08-25T18:00:00.000Z',
    });
    expect(c.bus.sent[0]).toMatchObject({
      topic: 'school', payload: { event: 'piano-lesson-complete', learnerId: 'learner4', lesson: 'Unit 3 Lesson 7' },
    });
    expect(c.fired[0]).toMatchObject({ result: 'satisfied', learnerId: 'learner4', lesson: 'Unit 3 Lesson 7' });
    expect(c.evidence[0]).toMatchObject({
      evidenceId: 'piano-challenge:learner4:2026-08-25:unit-3-c-major',
      activity: { kind: 'piano_challenge' },
      source: { transport: 'piano-challenge' },
    });
    expect(validateLearningEvidence(c.evidence[0]).errors).toEqual([]);
  });

  it('announces on both limbs when an enrolled learner satisfies the day', async () => {
    await ctx.bus.emit('piano.lesson.completed', { userId: 'learner4', plexId: 'plex:9001', title: 'Unit 3 Lesson 7' });

    expect(ctx.bus.sent).toHaveLength(1);
    expect(ctx.bus.sent[0].topic).toBe('school');
    expect(ctx.bus.sent[0].payload).toMatchObject({
      event: 'piano-lesson-complete', learnerId: 'learner4', lesson: 'Unit 3 Lesson 7', courseId: COURSE,
    });

    expect(ctx.fired).toHaveLength(1);
    expect(ctx.fired[0]).toMatchObject({
      result: 'satisfied', learnerId: 'learner4', subject: 'arts', course: COURSE, lesson: 'Unit 3 Lesson 7',
    });
    // The HA script gets the display name, not the id — it is read aloud or
    // shown on a phone, where "learner4" is worse than "LEARNER4!".
    expect(ctx.fired[0].student).toBe('LEARNER4!');
    expect(ctx.evidence[0]).toMatchObject({
      learnerId: 'learner4', verification: 'verified',
      learning: { subjectId: 'arts', courseId: COURSE, unitId: 'plex:season:3', lessonId: 'plex:9001' },
      measures: { completions: 1 },
      source: { surface: 'piano-kiosk', transport: 'playback' },
    });
    expect(validateLearningEvidence(ctx.evidence[0]).errors).toEqual([]);
  });

  it('reconciles historical Piano completions into idempotent School course/unit/lesson evidence', async () => {
    const rows = new Map();
    const bridge = new PianoLessonCeremonyBridge({
      realtime: new EventBusSchoolRealtimeAdapter({ eventBus: fakeBus() }),
      assignments: {
        get: async () => null,
        list: async () => [{ learnerId: 'learner4', programs: ENROLLED }],
      },
      launcher: {
        id: 'piano-course',
        status: async () => ({ completedLessons: [completion(), completion('plex:9002', 'Unit 3 Lesson 8')] }),
      },
      evidenceRepository: {
        appendEvidence: async (row) => {
          if (!rows.has(row.evidenceId)) rows.set(row.evidenceId, row);
          return { status: rows.get(row.evidenceId) === row ? 'recorded' : 'duplicate' };
        },
      },
      logger: { warn() {}, info() {} },
    });

    await bridge.reconcile();
    await bridge.reconcile();

    expect([...rows.keys()]).toEqual([
      'piano-lesson:learner4:plex:9001',
      'piano-lesson:learner4:plex:9002',
    ]);
    expect([...rows.values()].map((row) => row.learning)).toEqual([
      expect.objectContaining({ courseId: COURSE, unitId: 'plex:season:3', lessonId: 'plex:9001' }),
      expect.objectContaining({ courseId: COURSE, unitId: 'plex:season:3', lessonId: 'plex:9002' }),
    ]);
  });

  it('fires once per learner per study day, not once per lesson', async () => {
    await ctx.bus.emit('piano.lesson.completed', { userId: 'learner4', plexId: 'plex:9001', title: 'one' });
    await ctx.bus.emit('piano.lesson.completed', { userId: 'learner4', plexId: 'plex:9002', title: 'two' });
    expect(ctx.fired).toHaveLength(1);
    expect(ctx.bus.sent).toHaveLength(1);
    expect(ctx.evidence).toHaveLength(2);
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
    await c.bus.emit('piano.lesson.completed', { userId: 'learner4', plexId: 'plex:9001' });
    expect(c.fired).toHaveLength(0);
    expect(c.bus.sent).toHaveLength(0);
  });

  it('does not celebrate an EXCUSED day — nothing was accomplished', async () => {
    const c = build({ status: { doneToday: true, excused: true, progressLabel: 'waiting for learner3' } });
    await c.bus.emit('piano.lesson.completed', { userId: 'learner4', plexId: 'plex:9001' });
    expect(c.fired).toHaveLength(0);
    expect(c.bus.sent).toHaveLength(0);
  });

  it('stays silent when the course could not be read', async () => {
    const c = build({ status: { error: true } });
    await c.bus.emit('piano.lesson.completed', { userId: 'learner4', plexId: 'plex:9001' });
    expect(c.fired).toHaveLength(0);
    expect(c.bus.sent).toHaveLength(0);
  });

  it('still shows the Portal banner when Home Assistant refuses', async () => {
    const c = build({ hookResult: { ok: false, error: 'HA down' } });
    await c.bus.emit('piano.lesson.completed', { userId: 'learner4', plexId: 'plex:9001' });
    expect(c.bus.sent).toHaveLength(1);
  });

  it('still shows the Portal banner when the hook throws outright', async () => {
    const bus = fakeBus();
    const bridge = new PianoLessonCeremonyBridge({
      realtime: new EventBusSchoolRealtimeAdapter({ eventBus: bus }),
      assignments: assignmentsWith(ENROLLED),
      launcher: { id: 'piano-course', status: async () => ({ doneToday: true, completedLessonsToday: [completion()] }) },
      hook: { fire: async () => { throw new Error('boom'); } },
      clock: () => new Date('2026-08-25T20:00:00Z'),
      logger: { warn() {}, info() {} },
    });
    bridge.start();
    await bus.emit('piano.lesson.completed', { userId: 'learner4', plexId: 'plex:9001' });
    expect(bus.sent).toHaveLength(1);
  });

  it('works with no Home Assistant wired at all', async () => {
    const bus = fakeBus();
    const bridge = new PianoLessonCeremonyBridge({
      realtime: new EventBusSchoolRealtimeAdapter({ eventBus: bus }),
      assignments: assignmentsWith(ENROLLED),
      launcher: { id: 'piano-course', status: async () => ({ doneToday: true, completedLessonsToday: [completion()] }) },
      hook: null,
      clock: () => new Date('2026-08-25T20:00:00Z'),
      logger: { warn() {}, info() {} },
    });
    bridge.start();
    await bus.emit('piano.lesson.completed', { userId: 'learner4', plexId: 'plex:9001' });
    expect(bus.sent).toHaveLength(1);
  });

  it('ignores a payload with no learner', async () => {
    await ctx.bus.emit('piano.lesson.completed', { title: 'orphan' });
    expect(ctx.fired).toHaveLength(0);
  });

  it('stops cleanly, and stop() before start() is safe', () => {
    const bridge = new PianoLessonCeremonyBridge({
      realtime: new EventBusSchoolRealtimeAdapter({ eventBus: fakeBus() }),
      assignments: assignmentsWith(ENROLLED),
      launcher: { id: 'piano-course', status: async () => ({}) },
    });
    expect(() => bridge.stop()).not.toThrow();
    bridge.start();
    expect(() => bridge.stop()).not.toThrow();
  });
});
