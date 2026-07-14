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

function makeTimers() {
  let pending = [];
  return {
    setTimeoutFn: (fn) => { const t = { fn, cleared: false, unref() { return this; } }; pending.push(t); return t; },
    clearTimeoutFn: (t) => { if (t) t.cleared = true; },
    fireAll: async () => { const due = pending.filter((t) => !t.cleared); pending = []; for (const t of due) await t.fn(); },
  };
}

describe('ScaleNutribotBridge (idle-baseline)', () => {
  let bus, execute, expire, container, timers, expired;
  const emit = (grams, stable = true) => bus.emit('food-scale', { id: 'kitchen', grams, stable, unit: 'g' });

  beforeEach(() => {
    bus = makeBus();
    execute = jest.fn().mockResolvedValue({ success: true, logUuid: 'l1', messageId: 'm1' });
    expired = true;
    expire = jest.fn(async () => ({ success: true, expired }));
    container = { getLogFoodFromScale: () => ({ execute }), getExpireScaleLog: () => ({ execute: expire }) };
    timers = makeTimers();
    createScaleNutribotBridge({
      eventBus: bus, nutribotContainer: container,
      userId: 'kckern', conversationId: 'telegram:b1_c2',
      scaleConfig: normalizeScaleNutribotConfig({}), logger,
      setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn,
    });
  });

  it('learns the initial resting weight silently (no prompt)', async () => {
    emit(480); await flush();
    expect(execute).not.toHaveBeenCalled();
  });

  it('suppresses a re-settle within tolerance of the baseline (shelf jostle)', async () => {
    emit(480); await flush();      // baseline
    emit(477); await flush();      // -3, within tol(6)
    emit(481); await flush();      // +1
    expect(execute).not.toHaveBeenCalled();
  });

  it('prompts (gross) when the weight rises >= placementDelta above baseline', async () => {
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

  it('edits in place while loaded when the weight changes >= editDelta', async () => {
    emit(480); await flush();
    emit(680); await flush();      // placement
    emit(740); await flush();      // +60 while loaded → edit
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1][0]).toMatchObject({ grams: 740, existingLogUuid: 'l1', messageId: 'm1' });
  });

  it('re-arms after the food is removed (returns to baseline), then a new placement creates fresh', async () => {
    emit(480); await flush();
    emit(680); await flush();      // placement
    emit(482); await flush();      // back near baseline → removed
    emit(690); await flush();      // new placement
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1][0].existingLogUuid).toBeUndefined();
  });

  it('adopts a lower resting weight (tare to ~0), then a small placement prompts', async () => {
    emit(480); await flush();      // baseline
    emit(0); await flush();        // tared → baseline adopts 0
    emit(30); await flush();       // +30 above 0 → placement
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toMatchObject({ grams: 30 });
  });

  it('ignores wobble (unstable frames)', async () => {
    emit(480); await flush();
    emit(680, false); await flush();
    expect(execute).not.toHaveBeenCalled();
  });

  it('auto-expires an untouched prompt and adopts its weight as the new baseline', async () => {
    emit(30); await flush();       // baseline 30 (e.g. scale on counter)
    emit(480); await flush();      // moved onto shelf → looks like placement
    expect(execute).toHaveBeenCalledTimes(1);
    expired = true;
    await timers.fireAll();        // expire timer fires → untouched → rejected
    expect(expire).toHaveBeenCalledTimes(1);
    emit(481); await flush();      // shelf re-settle: now within tol of adopted baseline(480)
    expect(execute).toHaveBeenCalledTimes(1); // no new prompt
  });

  it('commits (keeps, stops prompting) when the user engaged before expiry', async () => {
    emit(480); await flush();
    emit(680); await flush();      // placement
    expired = false;               // user tapped density → ExpireScaleLog reports not-expired
    await timers.fireAll();        // expire fires → committed
    emit(750); await flush();      // more food while committed → no edit, no new prompt
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does not double-create when two placement frames arrive before the first resolves', async () => {
    emit(480); await flush();
    emit(680); emit(680);          // synchronous, before flush
    await flush();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
