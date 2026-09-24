import { describe, it, expect, vi } from 'vitest';
import { NearestIconChooser } from './NearestIconChooser.mjs';

const logger = () => ({ info: vi.fn(), warn: vi.fn() });
const answer = (choice, confidence) => ({ model: 'jev-1.13.0', answers: { icon: { type: 'choice', choice, confidence, probabilities: {} } } });
const VOCAB = ['plain-yogurt', 'berry-granola-yogurt-bowl', 'apple'];

describe('NearestIconChooser', () => {
  it('asks one choice over the whole vocabulary with the food as state', async () => {
    const decision = { isConfigured: () => true, evaluate: vi.fn(async () => answer('plain-yogurt', 0.9)) };
    const chooser = new NearestIconChooser({ decisionGateway: decision, logger: logger() });
    const fallback = vi.fn();
    const result = await chooser.choose({ name: 'Low Fat Yogurt', detail: { brand: 'Yoplait' }, vocabulary: VOCAB, fallback });
    expect(result).toEqual({ icon: 'plain-yogurt', via: 'jev', confidence: 0.9 });
    expect(fallback).not.toHaveBeenCalled();
    const [state, questions] = decision.evaluate.mock.calls[0];
    expect(state).toEqual({ food: 'Low Fat Yogurt', brand: 'Yoplait' });
    expect(Object.keys(questions.icon.options)).toEqual(VOCAB);
  });

  it('uses the fallback below the confidence floor', async () => {
    const decision = { isConfigured: () => true, evaluate: vi.fn(async () => answer('apple', 0.3)) };
    const chooser = new NearestIconChooser({ decisionGateway: decision, confidenceFloor: 0.5, logger: logger() });
    const result = await chooser.choose({ name: 'Yogurt', vocabulary: VOCAB, fallback: async () => 'plain-yogurt' });
    expect(result).toEqual({ icon: 'plain-yogurt', via: 'fallback', confidence: null });
  });

  it('uses the fallback when the decision model fails, and without one', async () => {
    const decision = { isConfigured: () => true, evaluate: vi.fn(async () => { throw new Error('429'); }) };
    const log = logger();
    const failing = new NearestIconChooser({ decisionGateway: decision, logger: log });
    expect(await failing.choose({ name: 'Yogurt', vocabulary: VOCAB, fallback: async () => 'apple' })).toMatchObject({ icon: 'apple', via: 'fallback' });
    expect(log.warn).toHaveBeenCalledWith('nutrition.icon.decision_failed', expect.objectContaining({ error: '429' }));

    const none = new NearestIconChooser({ logger: logger() });
    expect(none.hasDecisionModel).toBe(false);
    expect(await none.choose({ name: 'Yogurt', vocabulary: VOCAB, fallback: async () => 'apple' })).toMatchObject({ icon: 'apple', via: 'fallback' });
  });

  it('never returns a slug outside the vocabulary', async () => {
    const chooser = new NearestIconChooser({ logger: logger() });
    expect(await chooser.choose({ name: 'Yogurt', vocabulary: VOCAB, fallback: async () => 'default' })).toEqual({ icon: null, via: null, confidence: null });
    expect(await chooser.choose({ name: 'Yogurt', vocabulary: VOCAB })).toEqual({ icon: null, via: null, confidence: null });
  });

  it('treats an unconfigured gateway as absent', () => {
    expect(new NearestIconChooser({ decisionGateway: { isConfigured: () => false, evaluate: vi.fn() } }).hasDecisionModel).toBe(false);
  });
});
