import { describe, it, expect, vi } from 'vitest';
import { CloseLanguageDay } from './CloseLanguageDay.mjs';

const unit = { unitId: 'language-daily', program: 'language', programInstance: 'glossika-korean', title: 'Korean' };

function subject({ events = [] } = {}) {
  const stored = [...events];
  return {
    assignments: { get: vi.fn(async () => ({ units: ['language-daily'], programs: [{ programId: 'language', corpusId: 'glossika-korean', reward: { amount: 2 } }] })) },
    curriculum: { listUnits: vi.fn(async () => [unit]) },
    sessions: {
      readEvents: vi.fn(async () => [...stored]),
      appendEvent: vi.fn(async (_id, event) => { stored.push({ ...event, seq: stored.length + 1 }); return event; }),
    },
    close: { execute: vi.fn(async (args) => ({ status: 'settled', ...args })) },
    events: stored,
  };
}

describe('CloseLanguageDay', () => {
  it('lazily creates and closes one deterministic program session', async () => {
    const f = subject();
    const bridge = new CloseLanguageDay({ ...f, closeSessionOutcome: f.close, clock: () => new Date('2026-08-23T12:00:00Z') });
    const result = await bridge.handle({ learnerId: 'learner4', corpusId: 'glossika-korean', day: 4 });
    expect(f.sessions.appendEvent).toHaveBeenCalledTimes(2);
    expect(f.sessions.appendEvent.mock.calls.map(([, event]) => event.type)).toEqual(['created', 'program_dispatched']);
    expect(f.close.execute).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'ses_lang_learner4_glossika-korean_d4', honorClose: true, rewardOverride: { amount: 2 },
    }));
    expect(result.status).toBe('settled');
  });

  it('settles canonical Sentence Ladder completion against legacy unit and assignment ids', async () => {
    const f = subject();
    const bridge = new CloseLanguageDay({ ...f, closeSessionOutcome: f.close });
    await bridge.handle({
      learnerId: 'learner4', corpusId: 'glossika-korean', day: 4, programId: 'sentence-ladder',
    });

    expect(f.close.execute).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'ses_lang_learner4_glossika-korean_d4',
      honorClose: true,
      rewardOverride: { amount: 2 },
    }));
  });

  it('settles a legacy completion event against canonical unit and assignment ids', async () => {
    const f = subject();
    f.curriculum.listUnits.mockResolvedValue([{ ...unit, program: 'sentence-ladder' }]);
    f.assignments.get.mockResolvedValue({
      units: ['language-daily'],
      programs: [{ programId: 'sentence-ladder', corpusId: 'glossika-korean', reward: { amount: 3 } }],
    });
    const bridge = new CloseLanguageDay({ ...f, closeSessionOutcome: f.close });
    await bridge.handle({
      learnerId: 'learner4', corpusId: 'glossika-korean', day: 4, programId: 'language',
    });

    expect(f.close.execute).toHaveBeenCalledWith(expect.objectContaining({
      honorClose: true,
      rewardOverride: { amount: 3 },
    }));
  });

  it('does nothing when the program unit is not assigned', async () => {
    const f = subject();
    f.assignments.get.mockResolvedValue({ units: [] });
    const bridge = new CloseLanguageDay({ ...f, closeSessionOutcome: f.close });
    expect((await bridge.handle({ learnerId: 'learner4', corpusId: 'glossika-korean', day: 1 })).status).toBe('unassigned');
    expect(f.close.execute).not.toHaveBeenCalled();
  });

  // The shape production actually stores. Every learner plan on disk carries
  // `standaloneWork: []` and puts the ladder under `programs:`, and there is
  // no program-kind curriculum unit anywhere in the authored catalog — so a
  // lookup that gates on `units` finds nothing and never opens a session.
  it('opens a session for a program carried only under programs:', async () => {
    const f = subject();
    f.curriculum.listUnits.mockResolvedValue([]);
    f.assignments.get.mockResolvedValue({
      units: [],
      programs: [{ programId: 'sentence-ladder', corpusId: 'glossika-korean', reward: { amount: 5 } }],
    });
    const bridge = new CloseLanguageDay({ ...f, closeSessionOutcome: f.close });
    const result = await bridge.handle({
      learnerId: 'test-learner', corpusId: 'glossika-korean', day: 6, programId: 'sentence-ladder',
    });

    expect(f.sessions.appendEvent.mock.calls.map(([, event]) => event.type)).toEqual(['created', 'program_dispatched']);
    // The synthetic id the plan entry already uses, so the session the bridge
    // opens is the one the agenda row points at.
    expect(f.sessions.appendEvent.mock.calls[0][1].unitId).toBe('sentence-ladder:glossika-korean');
    expect(f.close.execute).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'ses_lang_test-learner_glossika-korean_d6', honorClose: true, rewardOverride: { amount: 5 },
    }));
    expect(result.status).toBe('settled');
  });

  it('prefers an authored curriculum unit id when the household wrote one', async () => {
    const f = subject();
    const bridge = new CloseLanguageDay({ ...f, closeSessionOutcome: f.close });
    await bridge.handle({ learnerId: 'test-learner', corpusId: 'glossika-korean', day: 2 });
    expect(f.sessions.appendEvent.mock.calls[0][1].unitId).toBe('language-daily');
  });

  it('still reports unassigned when the program is genuinely not assigned', async () => {
    const f = subject();
    f.curriculum.listUnits.mockResolvedValue([]);
    f.assignments.get.mockResolvedValue({ units: [], programs: [] });
    const bridge = new CloseLanguageDay({ ...f, closeSessionOutcome: f.close });
    expect((await bridge.handle({
      learnerId: 'test-learner', corpusId: 'glossika-korean', day: 1,
    })).status).toBe('unassigned');
    expect(f.sessions.appendEvent).not.toHaveBeenCalled();
    expect(f.close.execute).not.toHaveBeenCalled();
  });

  it('reports unassigned when another corpus is assigned but not this one', async () => {
    const f = subject();
    f.curriculum.listUnits.mockResolvedValue([]);
    f.assignments.get.mockResolvedValue({
      units: [],
      programs: [{ programId: 'sentence-ladder', corpusId: 'glossika-spanish' }],
    });
    const bridge = new CloseLanguageDay({ ...f, closeSessionOutcome: f.close });
    expect((await bridge.handle({
      learnerId: 'test-learner', corpusId: 'glossika-korean', day: 1,
    })).status).toBe('unassigned');
    expect(f.close.execute).not.toHaveBeenCalled();
  });

  // A second close-out re-prints the receipt. Found live 2026-09-12: reopening
  // a finished ladder day repeated this fact, and the printer ran six "PASSED"
  // slips for work finished the day before.
  it('does not close — or reprint — a day that is already settled', async () => {
    const { createEvent } = await import('#domains/school/sessions/sessionEvents.mjs');
    const sessionId = 'ses_lang_test-learner_glossika-korean_d1';
    const at = '2026-09-11T19:40:00.000Z';
    const events = [
      { type: 'created', at, sessionId, learnerId: 'test-learner', unitId: 'language-daily' },
      { type: 'program_dispatched', at, sessionId, programId: 'sentence-ladder', corpusId: 'glossika-korean', day: 1 },
      { type: 'outcome_recorded', at, sessionId, outcomeId: `out:${sessionId}`, result: 'passed', reason: 'program_complete' },
    ].map((raw, i) => {
      const { errors, event } = createEvent(raw);
      if (errors.length) throw new Error(errors.join('; '));
      return { ...event, seq: i + 1 };
    });
    const f = subject({ events });
    const bridge = new CloseLanguageDay({ ...f, closeSessionOutcome: f.close });

    const result = await bridge.handle({
      learnerId: 'test-learner', corpusId: 'glossika-korean', day: 1, programId: 'sentence-ladder',
    });

    expect(result).toEqual({ status: 'already_settled', sessionId });
    expect(f.close.execute).not.toHaveBeenCalled();
    expect(f.sessions.appendEvent).not.toHaveBeenCalled();
  });
});
