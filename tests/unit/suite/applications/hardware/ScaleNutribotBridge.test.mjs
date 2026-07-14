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

describe('ScaleNutribotBridge', () => {
  let bus, execute, container;
  beforeEach(() => {
    bus = makeBus();
    execute = jest.fn().mockResolvedValue({ success: true, logUuid: 'l1', messageId: 'm1' });
    container = { getLogFoodFromScale: () => ({ execute }) };
    createScaleNutribotBridge({
      eventBus: bus, nutribotContainer: container,
      userId: 'kckern', conversationId: 'telegram:b1_c2',
      scaleConfig: normalizeScaleNutribotConfig({}), logger,
    });
  });

  it('creates one prompt for a settled reading and ignores repeat frames', async () => {
    bus.emit('food-scale', { id: 'kitchen', grams: 240, stable: true, unit: 'g' });
    await flush();
    bus.emit('food-scale', { id: 'kitchen', grams: 240, stable: true, unit: 'g' }); // repeat, same weight
    await flush();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toMatchObject({ grams: 240, scaleId: 'kitchen' });
    expect(execute.mock.calls[0][0].existingLogUuid).toBeUndefined();
  });

  it('ignores a wobble (unstable) while loaded — no new prompt', async () => {
    bus.emit('food-scale', { id: 'kitchen', grams: 240, stable: true, unit: 'g' });
    await flush();
    bus.emit('food-scale', { id: 'kitchen', grams: 235, stable: false, unit: 'g' }); // bump: still loaded, unstable
    bus.emit('food-scale', { id: 'kitchen', grams: 240, stable: true, unit: 'g' });  // re-settles same weight
    await flush();
    expect(execute).toHaveBeenCalledTimes(1); // no second dispatch
  });

  it('edits in place when the settled weight changes by >= editDeltaG', async () => {
    bus.emit('food-scale', { id: 'kitchen', grams: 210, stable: true, unit: 'g' });
    await flush();
    bus.emit('food-scale', { id: 'kitchen', grams: 340, stable: true, unit: 'g' });
    await flush();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1][0]).toMatchObject({ grams: 340, existingLogUuid: 'l1', messageId: 'm1' });
  });

  it('does not re-dispatch for a sub-threshold weight change', async () => {
    bus.emit('food-scale', { id: 'kitchen', grams: 210, stable: true, unit: 'g' });
    await flush();
    bus.emit('food-scale', { id: 'kitchen', grams: 212, stable: true, unit: 'g' }); // +2g < editDeltaG(3)
    await flush();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('re-arms only after the scale returns to (near) empty', async () => {
    bus.emit('food-scale', { id: 'kitchen', grams: 240, stable: true, unit: 'g' });
    await flush();
    bus.emit('food-scale', { id: 'kitchen', grams: 1, stable: true, unit: 'g' }); // removed → empty
    await flush();
    bus.emit('food-scale', { id: 'kitchen', grams: 300, stable: true, unit: 'g' }); // new item
    await flush();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1][0].existingLogUuid).toBeUndefined(); // fresh create, not an edit
  });

  it('ignores readings below min_grams', async () => {
    bus.emit('food-scale', { id: 'kitchen', grams: 2, stable: true, unit: 'g' });
    await flush();
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not double-create when two settled frames arrive before the first resolves', async () => {
    bus.emit('food-scale', { id: 'kitchen', grams: 240, stable: true, unit: 'g' });
    bus.emit('food-scale', { id: 'kitchen', grams: 240, stable: true, unit: 'g' }); // synchronous, before flush
    await flush();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
