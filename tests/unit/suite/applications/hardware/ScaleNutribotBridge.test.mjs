import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { createScaleNutribotBridge } from '#apps/hardware/ScaleNutribotBridge.mjs';
import { normalizeScaleNutribotConfig } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const flush = () => new Promise((r) => setTimeout(r, 0));

function makeBus() {
  const handlers = {};
  return {
    subscribe: (topic, cb) => { (handlers[topic] ||= []).push(cb); return () => {}; },
    emit: (topic, payload) => (handlers[topic] || []).forEach((cb) => cb(payload)),
  };
}

describe('ScaleNutribotBridge (idle-baseline, new-message-per-value, no expiry)', () => {
  let bus, execute, container;
  const emit = (grams, stable = true) => bus.emit('food-scale', { id: 'kitchen', grams, stable, unit: 'g' });
  const press = (p = 'short') => bus.emit('food-scale', { id: 'kitchen', event: 'button', press: p });

  beforeEach(() => {
    bus = makeBus();
    execute = jest.fn().mockResolvedValue({ success: true, logUuid: 'l1', messageId: 'm1' });
    // No getExpireScaleLog — the bridge must never reach for expiry. If it did, this
    // container would throw and the test would fail.
    container = { getLogFoodFromScale: () => ({ execute }) };
    createScaleNutribotBridge({
      eventBus: bus, nutribotContainer: container,
      userId: 'kckern', conversationId: 'telegram:b1_c2',
      scaleConfig: normalizeScaleNutribotConfig({}), logger,
    });
  });

  it('learns the initial resting weight silently (no push)', async () => {
    emit(480); await flush();
    expect(execute).not.toHaveBeenCalled();
  });

  it('suppresses a re-settle within tolerance of the baseline (shelf jostle)', async () => {
    emit(480); await flush();      // baseline
    emit(477); await flush();      // -3, within tol(6)
    emit(481); await flush();      // +1
    expect(execute).not.toHaveBeenCalled();
  });

  it('pushes (gross) as a NEW message when the weight rises >= placementDelta above baseline', async () => {
    emit(480); await flush();      // baseline
    emit(680); await flush();      // +200 → placement
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toMatchObject({ grams: 680, scaleId: 'kitchen' });
    expect(execute.mock.calls[0][0].existingLogUuid).toBeUndefined();
  });

  it('ignores a rise smaller than placementDelta', async () => {
    emit(480); await flush();
    emit(487); await flush();      // +7 < placementDelta(10)
    expect(execute).not.toHaveBeenCalled();
  });

  it('posts a NEW message (not an edit) for each distinct value while loaded', async () => {
    emit(480); await flush();
    emit(680); await flush();      // placement → push #1
    emit(740); await flush();      // +60 → distinct value → push #2 (new message)
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1][0]).toMatchObject({ grams: 740, scaleId: 'kitchen' });
    expect(execute.mock.calls[1][0].existingLogUuid).toBeUndefined(); // NOT an edit
  });

  it('does not repeat a message for the same held value (dedup)', async () => {
    emit(480); await flush();
    emit(680); await flush();      // push
    emit(681); await flush();      // +1 < dedupDelta(5) → no repeat
    emit(683); await flush();      // +3 from last pushed → still < dedup
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('re-arms after the food is removed (returns to baseline), then a new placement pushes fresh', async () => {
    emit(480); await flush();
    emit(680); await flush();      // placement
    emit(482); await flush();      // back near baseline → removed / session ends
    emit(690); await flush();      // new placement
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1][0].existingLogUuid).toBeUndefined();
  });

  it('adopts a lower resting weight (tare to ~0), then a small placement pushes', async () => {
    emit(480); await flush();      // baseline
    emit(0); await flush();        // tared → baseline adopts 0
    emit(30); await flush();       // +30 above 0 → placement
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toMatchObject({ grams: 30 });
  });

  it('ignores wobble (unstable frames) on the auto path', async () => {
    emit(480); await flush();
    emit(680, false); await flush();
    expect(execute).not.toHaveBeenCalled();
  });

  it('logs the shelf-storage settle once and never repeats it (weights do not expire)', async () => {
    emit(0); await flush();        // resting baseline 0 (counter, empty)
    emit(574); await flush();      // flipped onto shelf → looks like a placement → ONE push
    emit(574); await flush();      // still sitting there → no repeat
    emit(575); await flush();      // +1 → still within dedup → no repeat
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toMatchObject({ grams: 574 });
  });

  it('does not double-create when two placement frames arrive before the first resolves', async () => {
    emit(480); await flush();
    emit(680); emit(680);          // synchronous, before flush
    await flush();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('FORCE: a button press logs the live weight even when auto would suppress it', async () => {
    emit(480); await flush();      // baseline
    emit(487); await flush();      // +7 < placementDelta → auto ignores, but tracked as live weight
    expect(execute).not.toHaveBeenCalled();
    press(); await flush();        // button → force-log the live 487g
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toMatchObject({ grams: 487, scaleId: 'kitchen' });
    expect(execute.mock.calls[0][0].existingLogUuid).toBeUndefined();
  });

  it('FORCE: captures the latest weight even from an unstable frame', async () => {
    emit(480); await flush();      // baseline
    emit(690, false); await flush(); // unstable → auto ignores, live weight = 690
    press(); await flush();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toMatchObject({ grams: 690 });
  });

  it('FORCE: does nothing when there is no weight yet', async () => {
    press(); await flush();
    expect(execute).not.toHaveBeenCalled();
  });
});
