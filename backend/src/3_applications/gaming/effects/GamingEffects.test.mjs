import { describe, expect, it, vi } from 'vitest';
import { NewestWinsAiPolicy } from './NewestWinsAiPolicy.mjs';
import { OncePerSessionPrintPolicy } from './OncePerSessionPrintPolicy.mjs';
import { GamingEffectService, normalizeAiEffect } from './GamingEffectService.mjs';

describe('Gaming effects', () => {
  it('fails open and keeps only the newest AI response', async () => {
    const resolvers = []; const policy = new NewestWinsAiPolicy({ proposalGenerator: { generate: () => new Promise((resolve) => resolvers.push(resolve)) }, timeoutMs: 10_000 });
    const first = policy.propose('session', { messages: [] }); const second = policy.propose('session', { messages: [] });
    resolvers[0]('old'); resolvers[1]('new');
    await expect(first).resolves.toBeNull(); await expect(second).resolves.toBe('new');
    await expect(new NewestWinsAiPolicy({ proposalGenerator: { generate: async () => { throw new Error('offline'); } } }).propose('x', { messages: [] })).resolves.toBeNull();
  });

  it('prints at most once per session', async () => {
    const values = new Map(); const receipts = { get: async (key) => values.get(key), put: async (key, value) => values.set(key, value) };
    const printer = { print: vi.fn(async () => ({ job: 1 })) }; const policy = new OncePerSessionPrintPolicy({ renderer: { render: async () => Buffer.from('pdf') }, printer, receipts });
    expect((await policy.print({ sessionId: 's1', content: {} })).status).toBe('printed'); expect((await policy.print({ sessionId: 's1', content: {} })).duplicate).toBe(true); expect(printer.print).toHaveBeenCalledOnce();
  });

  it('auto-prints a party-games host packet only when explicitly configured', async () => {
    const printPolicy = { print: vi.fn(async () => ({ status: 'printed' })) };
    const session = { header: { session_id: 's1', ruleset: { id: 'activity-party' }, launch: { surface_id: 'party-games' } } };
    await new GamingEffectService({ printPolicy, autoPrint: false }).afterCreate({ session, definition: { title: 'Party' } });
    expect(printPolicy.print).not.toHaveBeenCalled();
    await new GamingEffectService({ printPolicy, autoPrint: true }).afterCreate({ session, definition: { title: 'Party' } });
    expect(printPolicy.print).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1', explicit: false, autoPrint: true }));
  });

  it('records advisory effects without changing committed state', async () => {
    const effects = []; const service = new GamingEffectService({ aiPolicy: { propose: async () => 'Nice work!' }, store: { appendEffect: async (_id, value) => effects.push(value) }, observability: { increment() {}, audit: async () => {} } });
    const state = { phase: 'adjudication' }; await service.afterCommit({ sessionId: 's', command: { actor_id: 'host', command: {} }, viewer: { role: 'host' }, result: { header: { ruleset: { id: 'activity-party' }, revision: 1 }, state, events: [{ event_id: 'e', event: { type: 'challenge.finished' } }] } });
    expect(effects[0]).toMatchObject({ type: 'ai.commentary', content: 'Nice work!' }); expect(state).toEqual({ phase: 'adjudication' });
  });

  it('accepts only explicitly advisory structured judgment proposals', () => {
    expect(normalizeAiEffect('outcome.proposed', '{"advisory":true,"recommendation":"confirm","reason":"The gesture matched."}')).toEqual({
      type: 'ai.judgment-proposal', proposal: { advisory: true, recommendation: 'confirm', reason: 'The gesture matched.' },
    });
    expect(normalizeAiEffect('outcome.proposed', 'Looks correct to me')).toBeNull();
    expect(normalizeAiEffect('outcome.proposed', '{"advisory":false,"recommendation":"confirm","reason":"Because"}')).toBeNull();
  });

  it('honors commentary and advisory feature switches independently', async () => {
    const propose = vi.fn(async () => '{"advisory":true,"recommendation":"abstain","reason":"Not enough evidence."}');
    const stored = [];
    const service = new GamingEffectService({
      aiPolicy: { propose }, aiCommentary: false, aiAdvisoryJudgment: true,
      store: { appendEffect: async (_id, effect) => stored.push(effect) },
      observability: { increment() {}, audit: async () => {} },
    });
    await service.afterCommit({
      sessionId: 's', command: { actor_id: 'host', command: {} }, viewer: { role: 'host' },
      result: { header: { ruleset: { id: 'activity-party' }, revision: 2 }, state: {}, events: [
        { event_id: 'comment', event: { type: 'challenge.finished' } },
        { event_id: 'advice', event: { type: 'outcome.proposed' } },
      ] },
    });
    expect(propose).toHaveBeenCalledOnce();
    expect(stored).toEqual([expect.objectContaining({ type: 'ai.judgment-proposal', causation_id: 'advice' })]);
  });

  it('deletes active drawing checkpoints after terminal challenge events', async () => {
    const drawingCheckpoints = { delete: vi.fn(async () => true) };
    const service = new GamingEffectService({ drawingCheckpoints, observability: { increment() {}, audit: async () => {} } });
    const base = { sessionId: 's', command: { actor_id: 'host', command: {} }, viewer: { role: 'host' } };
    await service.afterCommit({ ...base, result: { header: { ruleset: { id: 'activity-party' }, revision: 1 }, state: {}, events: [{ event: { type: 'host.reveal.advanced' } }] } });
    expect(drawingCheckpoints.delete).not.toHaveBeenCalled();
    await service.afterCommit({ ...base, result: { header: { ruleset: { id: 'activity-party' }, revision: 2 }, state: {}, events: [{ event: { type: 'challenge.finished' } }] } });
    expect(drawingCheckpoints.delete).toHaveBeenCalledWith('s');
  });

  it('fails open when drawing checkpoint cleanup fails', async () => {
    const operational = vi.fn();
    const service = new GamingEffectService({
      drawingCheckpoints: { delete: async () => { throw new Error('storage offline'); } },
      observability: { increment() {}, audit: async () => {}, operational },
    });
    await expect(service.afterCommit({
      sessionId: 's', command: { actor_id: 'host', command: {} }, viewer: { role: 'host' },
      result: { header: { ruleset: { id: 'activity-party' }, revision: 3 }, state: {}, events: [{ event: { type: 'challenge.finished' } }] },
    })).resolves.toBeUndefined();
    expect(operational).toHaveBeenCalledWith('gaming.effect.failed', expect.objectContaining({ stage: 'drawing-checkpoint-delete' }), 'warn');
  });
});
