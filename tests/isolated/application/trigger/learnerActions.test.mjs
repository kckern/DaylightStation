import { describe, it, expect } from 'vitest';
import { createLearnerActions } from '#apps/trigger/learnerActions.mjs';
import { responseHandlers } from '#apps/trigger/responseHandlers.mjs';

const silent = { warn() {}, info() {}, error() {}, debug() {} };

describe('createLearnerActions', () => {
  it('routes a registered op to its handler with the learner and location', async () => {
    const seen = [];
    const learnerActions = createLearnerActions({ logger: silent });
    learnerActions.register('print-agenda', async ({ learnerId, location }) => {
      seen.push({ learnerId, location });
      return { status: 'agenda_printed' };
    });
    const result = await responseHandlers.learner(
      { kind: 'learner', op: 'print-agenda', learnerId: 'user_4', location: 'study' },
      { learnerActions, logger: silent },
    );
    expect(seen).toEqual([{ learnerId: 'user_4', location: 'study' }]);
    expect(result.status).toBe('agenda_printed');
  });

  it('refuses an unregistered op by NAME rather than falling back to another handler', async () => {
    const learnerActions = createLearnerActions({ logger: silent });
    learnerActions.register('print-agenda', async () => ({ status: 'agenda_printed' }));
    const result = await responseHandlers.learner(
      { kind: 'learner', op: 'reading-session', learnerId: 'user_5', location: 'livingroom' },
      { learnerActions, logger: silent },
    );
    expect(result).toMatchObject({ status: 'no_handler', op: 'reading-session' });
  });

  it('names the op and the reader in the refusal log, so the gap is findable', async () => {
    const warns = [];
    const logger = { ...silent, warn: (event, data) => warns.push([event, data]) };
    const learnerActions = createLearnerActions({ logger: silent });
    await responseHandlers.learner(
      { kind: 'learner', op: 'reading-session', learnerId: 'user_5', location: 'livingroom' },
      { learnerActions, logger },
    );
    expect(warns).toEqual([['trigger.learner.no_handler', expect.objectContaining({
      op: 'reading-session', learnerId: 'user_5', location: 'livingroom',
    })]]);
  });

  it('refuses rather than throwing when no registry was injected at all', async () => {
    // An unwired composition must degrade to the same named refusal, not to a
    // TypeError that reads as a dispatch failure of the tap itself.
    const result = await responseHandlers.learner(
      { kind: 'learner', op: 'print-agenda', learnerId: 'user_4', location: 'study' },
      { logger: silent },
    );
    expect(result).toMatchObject({ status: 'no_handler', op: 'print-agenda' });
  });

  it('never rejects when a handler throws', async () => {
    const learnerActions = createLearnerActions({ logger: silent });
    learnerActions.register('boom', async () => { throw new Error('printer on fire'); });
    const result = await responseHandlers.learner(
      { kind: 'learner', op: 'boom', learnerId: 'user_2', location: 'study' },
      { learnerActions, logger: silent },
    );
    expect(result).toMatchObject({ status: 'failed' });
    expect(result.error).toContain('printer on fire');
  });

  it('never rejects when a handler rejects synchronously or returns nothing', async () => {
    const learnerActions = createLearnerActions({ logger: silent });
    learnerActions.register('sync-throw', () => { throw new Error('nope'); });
    learnerActions.register('void', async () => undefined);
    await expect(responseHandlers.learner(
      { kind: 'learner', op: 'sync-throw', learnerId: 'user_4', location: 'study' },
      { learnerActions, logger: silent },
    )).resolves.toMatchObject({ status: 'failed' });
    await expect(responseHandlers.learner(
      { kind: 'learner', op: 'void', learnerId: 'user_4', location: 'study' },
      { learnerActions, logger: silent },
    )).resolves.toMatchObject({ status: 'ok' });
  });

  it('refuses a duplicate registration rather than letting the last one win', () => {
    const learnerActions = createLearnerActions({ logger: silent });
    learnerActions.register('print-agenda', async () => ({}));
    expect(() => learnerActions.register('print-agenda', async () => ({}))).toThrow(/duplicate/);
  });

  it('refuses a registration with no op or no function', () => {
    const learnerActions = createLearnerActions({ logger: silent });
    expect(() => learnerActions.register('', async () => ({}))).toThrow();
    expect(() => learnerActions.register('print-agenda', 'not a function')).toThrow();
  });

  it('reports what is registered, so an unwired action is visible', () => {
    const learnerActions = createLearnerActions({ logger: silent });
    learnerActions.register('print-agenda', async () => ({}));
    expect(learnerActions.has('print-agenda')).toBe(true);
    expect(learnerActions.has('reading-session')).toBe(false);
    expect(learnerActions.list()).toEqual(['print-agenda']);
    expect(learnerActions.get('reading-session')).toBeNull();
  });
});

// "NEVER REJECTS" is only as true as the code OUTSIDE the try — which, in this
// codebase, is where a never-throw contract has leaked before: at the logger,
// and at a lookup sitting above the guarded block. Each of these was a real
// rejection, and a rejection here is a child getting silence.
describe('responseHandlers.learner — the never-reject contract, at its edges', () => {
  const learnerResponse = (op) => ({ kind: 'learner', op, learnerId: 'user_4', location: 'study' });

  it('survives a handler that throws something with no .message', async () => {
    const learnerActions = createLearnerActions({ logger: silent });
    learnerActions.register('throws-null', async () => { throw null; });
    const result = await responseHandlers.learner(learnerResponse('throws-null'), { learnerActions, logger: silent });
    expect(result).toMatchObject({ status: 'failed', op: 'throws-null' });
    expect(typeof result.error).toBe('string');
  });

  it('survives a registry whose get() throws', async () => {
    const learnerActions = { get() { throw new Error('registry exploded'); }, list: () => [] };
    const result = await responseHandlers.learner(learnerResponse('print-agenda'), { learnerActions, logger: silent });
    expect(result).toMatchObject({ status: 'failed' });
  });

  it('survives a logger that throws while refusing an unregistered op', async () => {
    const learnerActions = createLearnerActions({ logger: silent });
    const logger = { ...silent, warn() { throw new Error('log transport down'); } };
    const result = await responseHandlers.learner(learnerResponse('reading-session'), { learnerActions, logger });
    expect(result).toMatchObject({ status: 'no_handler', op: 'reading-session' });
  });

  it('survives a registry whose list() throws while building that refusal', async () => {
    const learnerActions = { get: () => null, list() { throw new Error('list exploded'); } };
    const result = await responseHandlers.learner(learnerResponse('reading-session'), { learnerActions, logger: silent });
    expect(result).toMatchObject({ status: 'no_handler', op: 'reading-session' });
  });

  it('does not turn a PRINTED agenda into a failure when the success log throws', async () => {
    const learnerActions = createLearnerActions({ logger: silent });
    learnerActions.register('print-agenda', async () => ({ status: 'agenda_printed', printed: true }));
    const logger = { ...silent, info() { throw new Error('log transport down'); } };
    const result = await responseHandlers.learner(learnerResponse('print-agenda'), { learnerActions, logger });
    expect(result).toMatchObject({ status: 'agenda_printed', printed: true });
  });

  it('survives a logger that throws while reporting a failure', async () => {
    const learnerActions = createLearnerActions({ logger: silent });
    learnerActions.register('boom', async () => { throw new Error('printer on fire'); });
    const logger = { ...silent, error() { throw new Error('log transport down'); } };
    const result = await responseHandlers.learner(learnerResponse('boom'), { learnerActions, logger });
    expect(result).toMatchObject({ status: 'failed' });
  });
});

// A handler that answers instead of throwing has no other way to say "let them
// try again" — the dispatcher's retry path hangs off a thrown error, which a
// never-rejecting handler can never reach.
describe('responseHandlers.learner — declaring retryability', () => {
  it('marks a thrown-handler failure retryable', async () => {
    const learnerActions = createLearnerActions({ logger: silent });
    learnerActions.register('boom', async () => { throw new Error('printer on fire'); });
    const result = await responseHandlers.learner(
      { kind: 'learner', op: 'boom', learnerId: 'user_2', location: 'study' },
      { learnerActions, logger: silent },
    );
    expect(result).toMatchObject({ status: 'failed', retryable: true });
  });

  it('does NOT mark a named refusal retryable — retrying it changes nothing', async () => {
    const learnerActions = createLearnerActions({ logger: silent });
    const result = await responseHandlers.learner(
      { kind: 'learner', op: 'reading-session', learnerId: 'user_5', location: 'livingroom' },
      { learnerActions, logger: silent },
    );
    expect(result.retryable).toBeUndefined();
  });
});
