import { describe, it, expect, vi } from 'vitest';
import { classifyEmail } from './classifyEmail.mjs';
import { itemFromMail } from '../domain/triageItem.mjs';

const item = itemFromMail({
  ref: { provider: 'mail-a', accountId: 'sample', kind: 'message', id: 'm1' }, threadId: 't', version: '1',
  from: { name: 'X', address: 'x@example.com' }, to: [], subject: 'Hello', snippet: 'hi', receivedAt: 1, labels: [],
  starred: false, hasAttachments: false, automated: true, ownerRepliedInThread: false,
});
const policy = { autoArchiveConfidence: 0.92 };
const ok = { blocked: false, rules: [] };
const ev = (choiceKey, confidence, urgentP = 0.1, probabilities = { [choiceKey]: confidence }) =>
  vi.fn(async () => ({ model: 'm', answers: {
    disposition: { type: 'choice', choice: choiceKey, confidence, probabilities },
    urgent: { type: 'yesNo', probability: urgentP } } }));

describe('classifyEmail', () => {
  it('pre-archives a confident unblocked archive', async () => {
    const p = await classifyEmail({ item, guard: ok, policy, evaluate: ev('archive', 0.95) });
    expect(p.preDo.action).toBe('archive');
    expect(p.itemId).toBe(item.id);
  });
  it('does not pre-archive when blocked, and names the rule', async () => {
    const p = await classifyEmail({ item, guard: { blocked: true, rules: ['money', 'deadline'] }, policy, evaluate: ev('archive', 0.95) });
    expect(p.preDo).toBeNull();
    expect(p.why).toContain('money and a deadline');
  });
  it('does not pre-archive below the threshold', async () => {
    const p = await classifyEmail({ item, guard: ok, policy, evaluate: ev('archive', 0.85) });
    expect(p.preDo).toBeNull();
  });
  it('marks a reply urgent at 0.8', async () => {
    const p = await classifyEmail({ item, guard: ok, policy, evaluate: ev('reply', 0.9, 0.8) });
    expect(p.step).toBe('reply');
    expect(p.urgent).toBe(true);
  });
  it('is not urgent when not a reply', async () => {
    const p = await classifyEmail({ item, guard: ok, policy, evaluate: ev('keep', 0.9, 0.9) });
    expect(p.urgent).toBe(false);
    expect(p.step).toBe('unsure');
  });
  it('states the top two when unsure', async () => {
    const p = await classifyEmail({ item, guard: ok, policy, evaluate: ev('archive', 0.55, 0.1, { archive: 0.55, reply: 0.3, keep: 0.1 }) });
    expect(p.why).toBe('Unsure: archive 55% / reply 30%');
  });
  it('degrades when evaluate rejects', async () => {
    const logger = { warn: vi.fn() };
    const p = await classifyEmail({ item, guard: ok, policy, evaluate: vi.fn().mockRejectedValue(new Error('timeout')), logger });
    expect(p.why).toBe('decision unavailable');
    expect(p.preDo).toBeNull();
    expect(p.suggested).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('triage.classify.decision_unavailable', expect.any(Object));
  });
  it('fails closed with no guard verdict', async () => {
    const p = await classifyEmail({ item, policy, evaluate: ev('archive', 0.99) });
    expect(p.preDo).toBeNull();
  });
  it('passes a compact state with no body', async () => {
    const evaluate = ev('keep', 0.9);
    await classifyEmail({ item, guard: ok, policy, evaluate });
    expect(evaluate.mock.calls[0][0]).toMatchObject({ subject: 'Hello', receivedAt: '1970-01-01T00:00:00.001Z' });
    expect(evaluate.mock.calls[0][2]).toEqual({ timeout: 20000 });
  });
});
