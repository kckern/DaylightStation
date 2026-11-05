import { describe, it, expect, vi } from 'vitest';
import { createFrameDriver } from './frameDriver.js';

function rig(extra = {}) {
  const queue = new Map();
  let seq = 0;
  let clock = 1000;
  const raf = vi.fn((cb) => { seq += 1; queue.set(seq, cb); return seq; });
  const caf = vi.fn((id) => { queue.delete(id); });
  const fire = (ts) => { const [id, cb] = [...queue][0]; queue.delete(id); cb(ts); };
  const onFrame = vi.fn(extra.onFrame || (() => {}));
  const driver = createFrameDriver({ onFrame, now: () => clock, raf, caf, ...extra.opts });
  return { queue, raf, caf, fire, onFrame, driver };
}

describe('createFrameDriver', () => {
  it('clamps elapsedS but reports rawElapsedS and the rAF timestamp', () => {
    const { driver, fire, onFrame } = rig({ opts: { maxFrameS: 0.1 } });
    driver.start();
    fire(1500);
    expect(onFrame).toHaveBeenCalledWith({ nowMs: 1500, rawElapsedS: 0.5, elapsedS: 0.1 });
  });

  it('parks when onFrame returns false and wake() re-arms', () => {
    const { driver, fire, raf } = rig({ onFrame: () => false });
    driver.start();
    expect(raf).toHaveBeenCalledTimes(1);
    fire(1016);
    expect(raf).toHaveBeenCalledTimes(1);
    expect(driver.running).toBe(false);
    driver.wake();
    expect(raf).toHaveBeenCalledTimes(2);
    expect(driver.running).toBe(true);
  });

  it('survives a throwing onFrame and requests the next frame', () => {
    let n = 0;
    const { driver, fire, raf } = rig({ onFrame: () => { n += 1; if (n === 1) throw new Error('boom'); } });
    driver.start();
    fire(1016);
    expect(raf).toHaveBeenCalledTimes(2);
    expect(driver.running).toBe(true);
  });

  it('stop() cancels the pending frame', () => {
    const { driver, caf, raf } = rig();
    driver.start();
    const id = raf.mock.results[0].value;
    driver.stop();
    expect(caf).toHaveBeenCalledWith(id);
    expect(driver.running).toBe(false);
  });

  it('is a no-op without rAF', () => {
    const driver = createFrameDriver({ onFrame() {}, raf: null });
    driver.start(); driver.wake();
    expect(driver.running).toBe(false);
  });
});
