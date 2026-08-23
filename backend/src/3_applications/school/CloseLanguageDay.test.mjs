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
    const result = await bridge.handle({ learnerId: 'felix', corpusId: 'glossika-korean', day: 4 });
    expect(f.sessions.appendEvent).toHaveBeenCalledTimes(2);
    expect(f.sessions.appendEvent.mock.calls.map(([, event]) => event.type)).toEqual(['created', 'program_dispatched']);
    expect(f.close.execute).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'ses_lang_felix_glossika-korean_d4', honorClose: true, rewardOverride: { amount: 2 },
    }));
    expect(result.status).toBe('settled');
  });

  it('does nothing when the program unit is not assigned', async () => {
    const f = subject();
    f.assignments.get.mockResolvedValue({ units: [] });
    const bridge = new CloseLanguageDay({ ...f, closeSessionOutcome: f.close });
    expect((await bridge.handle({ learnerId: 'felix', corpusId: 'glossika-korean', day: 1 })).status).toBe('unassigned');
    expect(f.close.execute).not.toHaveBeenCalled();
  });
});
