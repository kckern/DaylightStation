import { describe, expect, it } from 'vitest';
import { WordLadderTuner, TUNING_SCHEMA, validateTuning, systemPrompt } from './index.mjs';
import { TUNABLE, GROWN_UP_SETTINGS } from '#domains/school/wordLadder/index.mjs';

const quietLogger = { info() {}, warn() {}, error() {}, debug() {} };
const good = { status: 'on-track', notes: ['Steady week.'], changes: [{ setting: 'batch.newPerDay', to: 3, reason: 'cap hit 5 of 7 days' }] };

function fakeRuntime(structured) {
  const calls = [];
  return { calls, async execute(opts) { calls.push(opts); return { output: '', structured, status: 'completed' }; } };
}

describe('WordLadderTuner', () => {
  it('runs one tool-less structured step over the digest and returns the proposal', async () => {
    const runtime = fakeRuntime(good);
    const tuner = new WordLadderTuner({ agentRuntime: runtime, logger: quietLogger });
    const digest = { day: '2026-09-20', today: { quizzed: 4 } };
    expect(await tuner.tune(digest)).toEqual(good);
    const [call] = runtime.calls;
    expect(call.agent).toBe(tuner);
    expect(call.input).toBe(JSON.stringify(digest));
    expect(call.tools).toEqual([]);
    expect(call.systemPrompt).toBe(systemPrompt);
    expect(call.outputSchema).toBe(TUNING_SCHEMA);
    expect(call.limits).toEqual({ maxSteps: 1, timeoutMs: 30000 });
    expect(tuner.getTools()).toEqual([]);
    expect(WordLadderTuner.id).toBe('word-ladder-tuner');
  });

  it('accepts `runtime` as the dep name, like the nutrition auditor', async () => {
    const tuner = new WordLadderTuner({ runtime: fakeRuntime(good), logger: quietLogger });
    expect((await tuner.tune({})).status).toBe('on-track');
  });

  it.each([
    ['unknown status', { ...good, status: 'fine' }],
    ['too many notes', { ...good, notes: ['a', 'b', 'c', 'd'] }],
    ['a note that is not a string', { ...good, notes: [3] }],
    ['a change without a numeric target', { ...good, changes: [{ setting: 'round.size', to: '4', reason: 'r' }] }],
    ['a change missing its reason', { ...good, changes: [{ setting: 'round.size', to: 4 }] }],
    ['an extra key', { ...good, mood: 'happy' }],
    ['no structured output', undefined],
  ])('throws on %s', async (_label, structured) => {
    const tuner = new WordLadderTuner({ agentRuntime: fakeRuntime(structured), logger: quietLogger });
    await expect(tuner.tune({})).rejects.toThrow(/tuner output/);
  });

  it('validates the schema shape it declares', () => {
    expect(validateTuning(good)).toBe(good);
    expect(TUNING_SCHEMA.properties.status.enum).toEqual(['on-track', 'stuck', 'coasting', 'concern']);
    expect(TUNING_SCHEMA.properties.notes.maxItems).toBe(3);
  });

  it('the system prompt names every tunable, the brakes and the grown-up-only settings', () => {
    for (const key of Object.keys(TUNABLE)) expect(systemPrompt).toContain(key);
    for (const key of GROWN_UP_SETTINGS) expect(systemPrompt).toContain(key);
    expect(systemPrompt).toMatch(/one step/i);
    expect(systemPrompt).toMatch(/5 study days/);
    expect(systemPrompt).toMatch(/single day/i);
    expect(new WordLadderTuner({ agentRuntime: fakeRuntime(good) }).getSystemPrompt()).toBe(systemPrompt);
  });
});
