/**
 * A card tap at the study reader reports presence to Home Assistant, and the
 * report never sits on the tap's critical path.
 */
import { describe, it, expect, vi } from 'vitest';
import { makePrintAgendaHandler } from './LearnerCardActions.mjs';

const handlerFor = (result, presenceHook) => makePrintAgendaHandler({
  resolvePersonalCard: { execute: async () => result },
  realtime: { printAgendaReady() {} },
  presenceHook,
  logger: { info() {}, warn() {} },
});
const settle = async () => { for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0)); };

describe('makePrintAgendaHandler — presence hook', () => {
  for (const status of ['agenda_printed', 'agenda_suppressed', 'print_failed', 'unknown_learner']) {
    it(`fires once on ${status}`, async () => {
      const fire = vi.fn();
      await handlerFor({ status }, { fire })({ learnerId: 'test-learner', location: 'study' });
      await settle();
      expect(fire).toHaveBeenCalledTimes(1);
      expect(fire).toHaveBeenCalledWith(expect.objectContaining({
        source: 'card', location: 'study', learnerId: 'test-learner', event: status,
      }));
    });
  }

  it('a fire that never resolves does not delay the handler', async () => {
    const fire = vi.fn(() => new Promise(() => {}));
    const out = await handlerFor({ status: 'agenda_printed' }, { fire })({ learnerId: 'test-learner', location: 'study' });
    expect(out.status).toBe('agenda_printed');
  });

  it('a fire that throws or rejects does not fail the handler', async () => {
    for (const fire of [() => { throw new Error('boom'); }, () => Promise.reject(new Error('boom'))]) {
      const out = await handlerFor({ status: 'agenda_printed' }, { fire })({ learnerId: 'test-learner', location: 'study' });
      expect(out.status).toBe('agenda_printed');
    }
    await settle();
  });

  it('no presenceHook leaves the handler unchanged', async () => {
    const out = await handlerFor({ status: 'print_failed' }, undefined)({ learnerId: 'test-learner', location: 'study' });
    expect(out).toEqual({ status: 'print_failed', retryable: true });
  });
});
