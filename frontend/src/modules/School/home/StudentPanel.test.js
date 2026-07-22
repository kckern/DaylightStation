import { describe, it, expect } from 'vitest';
import { derivePanelModel, deriveLatestScore } from './StudentPanel.jsx';

const report = (over = {}) => ({
  program: 'language', instanceId: 'x', label: 'Glossika', state: 'active',
  lastActivity: null, next: { label: 'Next 5', blocked: false }, metrics: [], ...over,
});

describe('derivePanelModel', () => {
  it('leads with the first actionable report', () => {
    const m = derivePanelModel([report({ label: 'A' }), report({ label: 'B' })]);
    expect(m.primary.label).toBe('A');
    expect(m.allDone).toBe(false);
  });

  it('satisfied/complete reports never lead, and all-satisfied flips allDone', () => {
    const m = derivePanelModel([
      report({ state: 'satisfied' }),
      report({ state: 'complete' }),
    ]);
    expect(m.primary).toBe(null);
    expect(m.allDone).toBe(true);
  });

  it('no reports at all is not "done" — there was nothing to do', () => {
    expect(derivePanelModel([]).allDone).toBe(false);
    expect(derivePanelModel(null).allDone).toBe(false);
  });

  it('surfaces the primary\'s today metric and the newest lastActivity', () => {
    const m = derivePanelModel([
      report({ metrics: [{ kind: 'progress', scope: 'today', value: 3, total: 12 }], lastActivity: '2026-07-20T00:00:00Z' }),
      report({ lastActivity: '2026-07-22T00:00:00Z' }),
    ]);
    expect(m.today.value).toBe(3);
    expect(m.lastActivity).toBe('2026-07-22T00:00:00Z');
  });
});

describe('deriveLatestScore', () => {
  const titles = new Map([['caps', 'US State Capitals']]);

  it('picks the most recently touched lane and renders lifetime accuracy', () => {
    const s = deriveLatestScore([
      { bankId: 'caps', quiz: { attempts: 10, correct: 9, lastAt: '2026-07-22T01:00:00Z' }, flashcard: { attempts: 0, correct: 0, lastAt: null } },
      { bankId: 'old', quiz: { attempts: 4, correct: 1, lastAt: '2026-07-01T00:00:00Z' }, flashcard: { attempts: 0, correct: 0, lastAt: null } },
    ], titles);
    expect(s).toEqual({ label: 'US State Capitals', pct: 90 });
  });

  it('falls back to the bank id when no title is known, and null when no attempts', () => {
    const s = deriveLatestScore([
      { bankId: 'mystery', quiz: { attempts: 2, correct: 1, lastAt: '2026-07-22T00:00:00Z' }, flashcard: { attempts: 0, correct: 0, lastAt: null } },
    ], new Map());
    expect(s.label).toBe('mystery');
    expect(deriveLatestScore([], titles)).toBe(null);
    expect(deriveLatestScore(null, titles)).toBe(null);
  });
});
