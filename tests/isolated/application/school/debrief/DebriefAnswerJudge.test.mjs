// tests/isolated/application/school/debrief/DebriefAnswerJudge.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { DebriefAnswerJudge } from "../../../../../__app_modules/learning/school/server/application/debrief/DebriefAnswerJudge.mjs";
const silent = { info() {}, warn() {}, error() {}, debug() {} };
const choice = { id: 'q1', kind: 'choice', prompt: 'P', options: ['A', 'B'], answer: 'B' };
const short = { id: 'q3', kind: 'short', prompt: 'Explain', expected: 'plants make food from light' };

describe('DebriefAnswerJudge', () => {
  it('grades choice in code, no AI call', async () => {
    const chatStructured = vi.fn();
    const j = new DebriefAnswerJudge({ aiGateway: { chatStructured }, logger: silent });
    expect(await j.grade(choice, 'B')).toEqual({ correct: true, grade: null, reason: null });
    expect(await j.grade(choice, 'A')).toEqual({ correct: false, grade: null, reason: null });
    expect(chatStructured).not.toHaveBeenCalled();
  });
  it('grades a short answer with the model, pass at 6', async () => {
    const j = new DebriefAnswerJudge({ aiGateway: { chatStructured: async () => ({ score: 6, reason: 'close' }) }, logger: silent });
    expect(await j.grade(short, 'light makes food')).toEqual({ correct: true, grade: 6, reason: 'close' });
  });
  it('an empty short answer is wrong without a call', async () => {
    const chatStructured = vi.fn();
    expect(await new DebriefAnswerJudge({ aiGateway: { chatStructured }, logger: silent }).grade(short, '  ')).toMatchObject({ correct: false });
    expect(chatStructured).not.toHaveBeenCalled();
  });
  it('a failed or malformed grade is ungraded (null)', async () => {
    const bad = new DebriefAnswerJudge({ aiGateway: { chatStructured: async () => ({ score: 'x' }) }, logger: silent });
    expect((await bad.grade(short, 'something')).correct).toBeNull();
    const throws = new DebriefAnswerJudge({ aiGateway: { chatStructured: async () => { throw new Error('t'); } }, logger: silent });
    expect((await throws.grade(short, 'something')).correct).toBeNull();
  });
  it('the decision gateway only shadows (logged, never decides)', async () => {
    const info = vi.fn();
    const decisionGateway = { isConfigured: () => true, evaluate: async () => ({ model: 'jev', answers: { meaning: { type: 'score', score: 0, confidence: 0.9 } } }) };
    const j = new DebriefAnswerJudge({ aiGateway: { chatStructured: async () => ({ score: 9, reason: 'r' }) }, decisionGateway, logger: { ...silent, info } });
    expect((await j.grade(short, 'x')).correct).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(info).toHaveBeenCalledWith('school.debrief.judge-shadow', expect.objectContaining({ llm: 9 }));
  });
});
