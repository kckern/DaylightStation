// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { createNfcTapIngress } from '#composition/modules/nfcTapIngress.mjs';

const NOOP = { warn() {}, info() {}, debug() {}, error() {} };
const CARD_UID = '04669c0fcb2a81';

function makeBus() {
  const subs = new Map();
  const broadcasts = [];
  return {
    broadcasts,
    subscribe(topic, fn) {
      if (!subs.has(topic)) subs.set(topic, new Set());
      subs.get(topic).add(fn);
      return () => subs.get(topic).delete(fn);
    },
    broadcast(topic, payload) { broadcasts.push({ topic, payload }); },
    emit(topic, payload) { for (const fn of subs.get(topic) || []) fn(payload); },
    count(topic) { return (subs.get(topic) || new Set()).size; },
  };
}

// One registry, two kinds of tag on identical hardware.
const REGISTRY = {
  nfc: {
    tags: {
      [CARD_UID]: { global: { note: 'a personal card', school_learner: 'test-learner' }, overrides: {} },
      '838e6806': { global: { note: '3 pigs', plex: 620707 }, overrides: {} },
    },
  },
};

function harness({ registry = REGISTRY, school = true, trigger = true, location = 'schoolroom' } = {}) {
  const bus = makeBus();
  const resolvePersonalCard = school
    ? { execute: vi.fn(async () => ({ status: 'agenda_printed', printed: true, offers: [{}, {}] })) }
    : null;
  const triggerDispatchService = trigger
    ? { handleEvent: vi.fn(async () => ({ ok: true })) }
    : null;
  const ingress = createNfcTapIngress({
    eventBus: bus, topics: ['omr'], triggerConfig: registry,
    triggerDispatchService, resolvePersonalCard, location, logger: NOOP,
  });
  return { bus, ingress, resolvePersonalCard, triggerDispatchService };
}

describe('createNfcTapIngress', () => {
  it('routes a school card to ResolvePersonalCard and not to the trigger pipeline', async () => {
    const { ingress, resolvePersonalCard, triggerDispatchService } = harness();
    const out = await ingress.handleTap({ uid: CARD_UID, id: 'study-omr' });

    expect(resolvePersonalCard.execute).toHaveBeenCalledWith({ learnerId: 'test-learner' });
    expect(triggerDispatchService.handleEvent).not.toHaveBeenCalled();
    expect(out).toEqual({ status: 'agenda_printed', learnerId: 'test-learner' });
  });

  it('accepts the relay spelling of the uid', async () => {
    // The relay reports packed uppercase; the registry may hold it separated.
    const { ingress, resolvePersonalCard } = harness();
    await ingress.handleTap({ uid: '04:66:9C:0F:CB:2A:81' });
    expect(resolvePersonalCard.execute).toHaveBeenCalledWith({ learnerId: 'test-learner' });
  });

  it('sends a book tag to the trigger pipeline, not to School', async () => {
    const { ingress, resolvePersonalCard, triggerDispatchService } = harness();
    const out = await ingress.handleTap({ uid: '83_8e_68_06' });

    expect(triggerDispatchService.handleEvent).toHaveBeenCalledWith({
      location: 'schoolroom', source: 'nfc', value: '838e6806',
    });
    expect(resolvePersonalCard.execute).not.toHaveBeenCalled();
    expect(out.status).toBe('triggered');
  });

  it('sends an UNREGISTERED tag to the trigger pipeline so the unknown-tag notify still fires', async () => {
    // That notify is how a new card gets enrolled. Swallowing unknown tags here
    // would make enrolment impossible from the school reader.
    const { ingress, triggerDispatchService } = harness();
    await ingress.handleTap({ uid: '0a0b0c0d' });
    expect(triggerDispatchService.handleEvent).toHaveBeenCalledWith({
      location: 'schoolroom', source: 'nfc', value: '0a0b0c0d',
    });
  });

  it('reports loudly when a card is enrolled but School is not wired', async () => {
    // Worse than an unknown card: the child taps a card that IS theirs and
    // nothing happens. It must not look like success.
    const { ingress } = harness({ school: false });
    const out = await ingress.handleTap({ uid: CARD_UID });
    expect(out).toEqual({ status: 'school_unwired', learnerId: 'test-learner' });
  });

  it('subscribes to the bus and acts on nfc events only', async () => {
    const { bus, ingress, resolvePersonalCard } = harness();
    expect(bus.count('omr')).toBe(1);

    bus.emit('omr', { event: 'sheet', id: 'study-omr', marks: [1] });
    bus.emit('omr', { event: 'relay-status', id: 'study-omr' });
    await Promise.resolve();
    expect(resolvePersonalCard.execute).not.toHaveBeenCalled();

    bus.emit('omr', { event: 'nfc', id: 'study-omr', uid: CARD_UID });
    await Promise.resolve(); await Promise.resolve();
    expect(resolvePersonalCard.execute).toHaveBeenCalledWith({ learnerId: 'test-learner' });

    ingress.dispose();
    expect(bus.count('omr')).toBe(0);
  });

  it('never lets a failing tap reject into the bus', async () => {
    const bus = makeBus();
    const ingress = createNfcTapIngress({
      eventBus: bus,
      triggerConfig: REGISTRY,
      resolvePersonalCard: { execute: async () => { throw new Error('printer exploded'); } },
      logger: NOOP,
    });
    expect(ingress.wired).toBe(true);
    expect(() => bus.emit('omr', { event: 'nfc', uid: CARD_UID })).not.toThrow();
    await Promise.resolve(); await Promise.resolve();
  });

  it('reports not_wired rather than throwing when there is no bus', async () => {
    const ingress = createNfcTapIngress({ logger: NOOP });
    expect(ingress.wired).toBe(false);
    expect(await ingress.handleTap({ uid: CARD_UID })).toEqual({ status: 'not_wired' });
  });

  it('drops a tap with no usable uid', async () => {
    const { ingress, resolvePersonalCard } = harness();
    expect(await ingress.handleTap({ uid: '' })).toEqual({ status: 'no_uid' });
    expect(resolvePersonalCard.execute).not.toHaveBeenCalled();
  });

  // Slice G, 2026-08-22-omr-grading-integrity, Rule 3: a cooldown-suppressed
  // tap prints nothing, but it must still be ACKNOWLEDGED on the panel — a
  // child who taps and gets nothing at all just taps harder. This broadcasts
  // on the SAME `omr` topic Slice D's `useScanCeremony.js` already
  // subscribes to, the identical transport `schoolPrintScanConsumer.mjs`
  // uses for its own `scan-graded`/`scan-review`/... outcomes.
  it('broadcasts agenda-suppressed on the omr topic when ResolvePersonalCard suppresses a repeat print', async () => {
    const bus = makeBus();
    const resolvePersonalCard = {
      execute: vi.fn(async () => ({
        status: 'agenda_suppressed', learnerId: 'test-learner', printed: false,
        offers: [], sinceMinutes: 2, cooldownMinutes: 15,
        message: 'You already have today’s agenda — check your desk.',
      })),
    };
    const suppressedIngress = createNfcTapIngress({
      eventBus: bus, topics: ['omr'], triggerConfig: REGISTRY,
      resolvePersonalCard, location: 'schoolroom', logger: NOOP,
    });

    const out = await suppressedIngress.handleTap({ uid: CARD_UID, id: 'study-omr' });

    expect(out).toEqual({ status: 'agenda_suppressed', learnerId: 'test-learner' });
    expect(bus.broadcasts).toEqual([{
      topic: 'omr',
      payload: expect.objectContaining({
        event: 'agenda-suppressed', learnerId: 'test-learner', sinceMinutes: 2, cooldownMinutes: 15,
      }),
    }]);
  });

  it('does NOT broadcast agenda-suppressed on an ordinary agenda_printed tap', async () => {
    const { bus, ingress } = harness();
    await ingress.handleTap({ uid: CARD_UID, id: 'study-omr' });
    expect(bus.broadcasts).toEqual([]);
  });

  it('never throws when the bus has no broadcast method at all (older test doubles keep working)', async () => {
    const bus = makeBus();
    delete bus.broadcast;
    const resolvePersonalCard = {
      execute: vi.fn(async () => ({ status: 'agenda_suppressed', learnerId: 'test-learner', printed: false, offers: [] })),
    };
    const ingress = createNfcTapIngress({
      eventBus: bus, topics: ['omr'], triggerConfig: REGISTRY, resolvePersonalCard, location: 'schoolroom', logger: NOOP,
    });
    await expect(ingress.handleTap({ uid: CARD_UID })).resolves.toEqual({ status: 'agenda_suppressed', learnerId: 'test-learner' });
  });
});
