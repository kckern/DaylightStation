import { describe, expect, it } from 'vitest';
import { createEvent, reduceSession } from '#domains/school/sessions/sessionEvents.mjs';
import { SchoolCalcStudyOutcomeExecutor } from './SchoolCalcStudyOutcomeExecutor.mjs';

function memorySessions() {
  const events = new Map();
  return {
    events,
    readEvents: async (id) => structuredClone(events.get(id) ?? []),
    appendEvent: async (id, event) => {
      const list = events.get(id) ?? [];
      list.push({ ...event, seq: list.length + 1 });
      events.set(id, list);
    },
  };
}

async function setup() {
  const sessions = memorySessions();
  const created = createEvent({
    type: 'created', at: '2026-08-10T12:00:00.000Z', sessionId: 'work-one',
    learnerId: 'learner-one', unitId: 'unit-one',
  }).event;
  await sessions.appendEvent('work-one', created);
  return { sessions, executor: new SchoolCalcStudyOutcomeExecutor().bind({ sessions }) };
}

const studySession = {
  studySessionId: 'study-one', workSessionId: 'work-one',
  artifact: { artifactId: 'artifact-one' },
};

describe('SchoolCalcStudyOutcomeExecutor', () => {
  it('terminally serves a passing agenda session and replays idempotently', async () => {
    const { sessions, executor } = await setup();
    const input = {
      studySession, percent: 90, passingPercent: 80, resultDigest: 'digest-a',
      at: '2026-08-10T13:00:00.000Z', transport: 'qr',
    };
    await expect(executor.execute(input)).resolves.toMatchObject({ status: 'settled', result: 'passed' });
    expect(reduceSession(await sessions.readEvents('work-one'))).toMatchObject({
      terminal: true, outcome: { result: 'passed' }, gradedPercent: 90,
    });
    await expect(executor.execute(input)).resolves.toMatchObject({ status: 'duplicate', result: 'passed' });
  });

  it('terminally closes a failed attempt so the next agenda can issue fresh work', async () => {
    const { sessions, executor } = await setup();
    await expect(executor.execute({
      studySession, percent: 50, passingPercent: 80, resultDigest: 'digest-b',
      at: '2026-08-10T13:00:00.000Z', transport: 'relay',
    })).resolves.toMatchObject({ result: 'failed' });
    expect(reduceSession(await sessions.readEvents('work-one'))).toMatchObject({
      terminal: true, outcome: { result: 'needs_remediation' }, remediation: expect.any(Object),
    });
  });
});
