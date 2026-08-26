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
      { kind: 'learner', op: 'print-agenda', learnerId: 'learner-a', location: 'study' },
      { learnerActions, logger: silent },
    );
    expect(seen).toEqual([{ learnerId: 'learner-a', location: 'study' }]);
    expect(result.status).toBe('agenda_printed');
  });

  it('refuses an unregistered op by NAME rather than falling back to another handler', async () => {
    const learnerActions = createLearnerActions({ logger: silent });
    learnerActions.register('print-agenda', async () => ({ status: 'agenda_printed' }));
    const result = await responseHandlers.learner(
      { kind: 'learner', op: 'reading-session', learnerId: 'learner-c', location: 'livingroom' },
      { learnerActions, logger: silent },
    );
    expect(result).toMatchObject({ status: 'no_handler', op: 'reading-session' });
  });

  it('names the op and the reader in the refusal log, so the gap is findable', async () => {
    const warns = [];
    const logger = { ...silent, warn: (event, data) => warns.push([event, data]) };
    const learnerActions = createLearnerActions({ logger: silent });
    await responseHandlers.learner(
      { kind: 'learner', op: 'reading-session', learnerId: 'learner-c', location: 'livingroom' },
      { learnerActions, logger },
    );
    expect(warns).toEqual([['trigger.learner.no_handler', expect.objectContaining({
      op: 'reading-session', learnerId: 'learner-c', location: 'livingroom',
    })]]);
  });

  it('refuses rather than throwing when no registry was injected at all', async () => {
    // An unwired composition must degrade to the same named refusal, not to a
    // TypeError that reads as a dispatch failure of the tap itself.
    const result = await responseHandlers.learner(
      { kind: 'learner', op: 'print-agenda', learnerId: 'learner-a', location: 'study' },
      { logger: silent },
    );
    expect(result).toMatchObject({ status: 'no_handler', op: 'print-agenda' });
  });

  it('never rejects when a handler throws', async () => {
    const learnerActions = createLearnerActions({ logger: silent });
    learnerActions.register('boom', async () => { throw new Error('printer on fire'); });
    const result = await responseHandlers.learner(
      { kind: 'learner', op: 'boom', learnerId: 'learner-b', location: 'study' },
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
      { kind: 'learner', op: 'sync-throw', learnerId: 'learner-a', location: 'study' },
      { learnerActions, logger: silent },
    )).resolves.toMatchObject({ status: 'failed' });
    await expect(responseHandlers.learner(
      { kind: 'learner', op: 'void', learnerId: 'learner-a', location: 'study' },
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
