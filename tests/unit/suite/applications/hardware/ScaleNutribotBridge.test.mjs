import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { createScaleNutribotBridge } from '#apps/hardware/ScaleNutribotBridge.mjs';
import { normalizeScaleNutribotConfig } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

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
    execute = jest.fn().mockResolvedValue({ success: true });
    container = { getLogFoodFromScale: () => ({ execute }) };
    createScaleNutribotBridge({
      eventBus: bus, nutribotContainer: container,
      userId: 'kckern', conversationId: 'telegram:b1_c2',
      scaleConfig: normalizeScaleNutribotConfig({}), logger,
    });
  });

  it('fires once per settle cycle for a settled reading', () => {
    bus.emit('food-scale', { id: 'kitchen', grams: 240, stable: true, unit: 'g' });
    bus.emit('food-scale', { id: 'kitchen', grams: 240, stable: true, unit: 'g' }); // repeat frame, latched
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ grams: 240, userId: 'kckern', conversationId: 'telegram:b1_c2', scaleId: 'kitchen' }));
  });

  it('re-arms after going unstable, then fires again', () => {
    bus.emit('food-scale', { id: 'kitchen', grams: 240, stable: true, unit: 'g' });
    bus.emit('food-scale', { id: 'kitchen', grams: 130, stable: false, unit: 'g' }); // changing → re-arm
    bus.emit('food-scale', { id: 'kitchen', grams: 300, stable: true, unit: 'g' });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('ignores readings below min_grams', () => {
    bus.emit('food-scale', { id: 'kitchen', grams: 2, stable: true, unit: 'g' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('ignores non-settled frames', () => {
    bus.emit('food-scale', { id: 'kitchen', grams: 240, stable: false, unit: 'g' });
    expect(execute).not.toHaveBeenCalled();
  });
});
