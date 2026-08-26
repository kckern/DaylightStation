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

const READERS = { 'study-omr': 'study', 'livingroom-nfc': 'livingroom' };

function harness({ readerLocations = READERS, trigger = true } = {}) {
  const bus = makeBus();
  const triggerDispatchService = trigger
    ? { handleEvent: vi.fn(async () => ({ ok: true })) }
    : null;
  const ingress = createNfcTapIngress({
    eventBus: bus, topics: ['omr'], triggerDispatchService, readerLocations, logger: NOOP,
  });
  return { bus, ingress, triggerDispatchService };
}

// THE POINT OF THIS MODULE AFTER PLAN 01: transport, and nothing else. It used
// to fork on `school_learner` here, which is exactly why a learner card only
// ever worked at the ONE reader whose taps arrive over this bus. Every
// assertion below is about carrying a tap to the pipeline, never about what
// the tag means — that decision belongs to `NfcResolver` + `learner_action`.
describe('createNfcTapIngress — transport only', () => {
  it('hands a learner card to the trigger pipeline like any other tag', async () => {
    const { ingress, triggerDispatchService } = harness();
    const out = await ingress.handleTap({ uid: '04:66:9C:0F:CB:2A:81', id: 'study-omr' });

    expect(triggerDispatchService.handleEvent).toHaveBeenCalledWith({
      location: 'study', source: 'nfc', value: CARD_UID,
    });
    expect(out.status).toBe('triggered');
  });

  it('sends a book tag down the identical path — no branch distinguishes them here', async () => {
    const { ingress, triggerDispatchService } = harness();
    await ingress.handleTap({ uid: '83_8e_68_06', id: 'study-omr' });
    expect(triggerDispatchService.handleEvent).toHaveBeenCalledWith({
      location: 'study', source: 'nfc', value: '838e6806',
    });
  });

  it('sends an UNREGISTERED tag to the trigger pipeline so the unknown-tag notify still fires', async () => {
    // That notify is how a new card gets enrolled. Swallowing unknown tags here
    // would make enrolment impossible from this reader.
    const { ingress, triggerDispatchService } = harness();
    await ingress.handleTap({ uid: '0a0b0c0d', id: 'study-omr' });
    expect(triggerDispatchService.handleEvent).toHaveBeenCalledWith({
      location: 'study', source: 'nfc', value: '0a0b0c0d',
    });
  });

  it('maps each reader id to its OWN location', async () => {
    // The old module took a single global `location`, which assumed every
    // reader on this bus was in one room.
    const handled = [];
    const ingress = createNfcTapIngress({
      eventBus: makeBus(),
      readerLocations: READERS,
      triggerDispatchService: { handleEvent: async (e) => { handled.push(e.location); return { ok: true }; } },
      logger: NOOP,
    });
    await ingress.handleTap({ uid: 'deadbeef', id: 'livingroom-nfc' });
    await ingress.handleTap({ uid: 'deadbeef', id: 'study-omr' });
    expect(handled).toEqual(['livingroom', 'study']);
  });

  it('reports an unmapped reader rather than guessing a location', async () => {
    const { ingress, triggerDispatchService } = harness();
    expect(await ingress.handleTap({ uid: 'deadbeef', id: 'unknown-reader' }))
      .toMatchObject({ status: 'unmapped_reader', reader: 'unknown-reader' });
    expect(triggerDispatchService.handleEvent).not.toHaveBeenCalled();
  });

  it('reports an unmapped reader when a tap carries no reader id at all', async () => {
    const { ingress, triggerDispatchService } = harness();
    expect(await ingress.handleTap({ uid: 'deadbeef' })).toMatchObject({ status: 'unmapped_reader' });
    expect(triggerDispatchService.handleEvent).not.toHaveBeenCalled();
  });

  it('reports unmapped_reader when the dispatcher itself is missing', async () => {
    const { ingress } = harness({ trigger: false });
    expect(await ingress.handleTap({ uid: CARD_UID, id: 'study-omr' })).toMatchObject({ status: 'unmapped_reader' });
  });

  it('surfaces the dispatcher refusal code instead of claiming success', async () => {
    const ingress = createNfcTapIngress({
      eventBus: makeBus(),
      readerLocations: READERS,
      triggerDispatchService: { handleEvent: async () => ({ ok: false, code: 'LOCATION_NOT_FOUND' }) },
      logger: NOOP,
    });
    expect(await ingress.handleTap({ uid: CARD_UID, id: 'study-omr' }))
      .toEqual({ status: 'LOCATION_NOT_FOUND' });
  });

  it('subscribes to the bus and acts on nfc events only', async () => {
    const { bus, ingress, triggerDispatchService } = harness();
    expect(bus.count('omr')).toBe(1);

    bus.emit('omr', { event: 'sheet', id: 'study-omr', marks: [1] });
    bus.emit('omr', { event: 'relay-status', id: 'study-omr' });
    await Promise.resolve();
    expect(triggerDispatchService.handleEvent).not.toHaveBeenCalled();

    bus.emit('omr', { event: 'nfc', id: 'study-omr', uid: CARD_UID });
    await Promise.resolve(); await Promise.resolve();
    expect(triggerDispatchService.handleEvent).toHaveBeenCalledWith({
      location: 'study', source: 'nfc', value: CARD_UID,
    });

    ingress.dispose();
    expect(bus.count('omr')).toBe(0);
  });

  it('never lets a failing tap reject into the bus', async () => {
    const bus = makeBus();
    const ingress = createNfcTapIngress({
      eventBus: bus,
      readerLocations: READERS,
      triggerDispatchService: { handleEvent: async () => { throw new Error('dispatcher exploded'); } },
      logger: NOOP,
    });
    expect(ingress.wired).toBe(true);
    expect(() => bus.emit('omr', { event: 'nfc', id: 'study-omr', uid: CARD_UID })).not.toThrow();
    await Promise.resolve(); await Promise.resolve();
  });

  it('reports not_wired rather than throwing when there is no bus', async () => {
    const ingress = createNfcTapIngress({ logger: NOOP });
    expect(ingress.wired).toBe(false);
    expect(await ingress.handleTap({ uid: CARD_UID })).toEqual({ status: 'not_wired' });
  });

  it('drops a tap with no usable uid', async () => {
    const { ingress, triggerDispatchService } = harness();
    expect(await ingress.handleTap({ uid: '' })).toEqual({ status: 'no_uid' });
    expect(triggerDispatchService.handleEvent).not.toHaveBeenCalled();
  });

  it('does not broadcast anything of its own — acknowledgement is the action handler’s job', async () => {
    // `agenda-suppressed` moved to the print-agenda learner action, where the
    // suppression is actually known. Transport has no opinion to broadcast.
    const { bus, ingress } = harness();
    await ingress.handleTap({ uid: CARD_UID, id: 'study-omr' });
    expect(bus.broadcasts).toEqual([]);
  });
});

// MIGRATED from `backend/src/5_composition/modules/nfcTapIngress.shutdown.test.mjs`
// (node:test, colocated — a path no CI gate ever executed). The precedence it
// pinned survives the fork deletion, and now runs in a suite that is actually
// gated. The tag it uses is a LEARNER card on purpose: the original pinned
// shutdown above the school fork, and shutdown must still outrank the pipeline
// that fork became.
describe('createNfcTapIngress — the shutdown tag outranks everything', () => {
  it('the configured shutdown card activates shutdown before any trigger dispatch', async () => {
    const calls = [];
    const ingress = createNfcTapIngress({
      eventBus: { subscribe() { return () => {}; } },
      triggerDispatchService: { async handleEvent() { calls.push('trigger'); return { ok: true }; } },
      shutdownService: { async activate(payload) { calls.push(payload); return { lockedUntil: '2030-01-01T00:00:00.000Z' }; } },
      getShutdownConfig: () => ({ nfc: { reader_id: 'study-omr', tag_uid: '04aa660fcb2a81' } }),
      readerLocations: { 'study-omr': 'study' },
      logger: NOOP,
    });
    const result = await ingress.handleTap({ id: 'study-omr', uid: '04-AA-66-0F-CB-2A-81' });
    expect(result).toEqual({ status: 'shutdown_locked', lockedUntil: '2030-01-01T00:00:00.000Z' });
    expect(calls).toEqual([{ readerId: 'study-omr', tagUid: '04aa660fcb2a81' }]);
  });

  it('the configured shutdown card cannot activate from a different reader', async () => {
    let activations = 0;
    const ingress = createNfcTapIngress({
      eventBus: { subscribe() { return () => {}; } },
      shutdownService: { async activate() { activations += 1; } },
      getShutdownConfig: () => ({ nfc: { reader_id: 'study-omr', tag_uid: '04aa660fcb2a81' } }),
      logger: NOOP,
    });
    const result = await ingress.handleTap({ id: 'other-reader', uid: '04aa660fcb2a81' });
    // `unrouted` in the old module; the reader is simply not mapped now.
    expect(result.status).toBe('unmapped_reader');
    expect(activations).toBe(0);
  });

  it('a shutdown tap is checked before the reader map, so an unmapped reader cannot disarm it', async () => {
    // The pre-check reads `shutdown.yml`, not the tag registry. If it were
    // ordered after the reader lookup, a reader missing from the map would
    // turn the household safety command into `unmapped_reader`.
    const ingress = createNfcTapIngress({
      eventBus: { subscribe() { return () => {}; } },
      shutdownService: { async activate() { return { lockedUntil: '2030-01-01T00:00:00.000Z' }; } },
      getShutdownConfig: () => ({ nfc: { tag_uid: '04aa660fcb2a81' } }),
      readerLocations: {},
      logger: NOOP,
    });
    expect(await ingress.handleTap({ id: 'no-such-reader', uid: '04aa660fcb2a81' }))
      .toMatchObject({ status: 'shutdown_locked' });
  });
});
