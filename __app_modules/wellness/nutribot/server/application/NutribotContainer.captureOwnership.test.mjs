import { describe, it, expect } from 'vitest';
import { NutribotContainer } from './NutribotContainer.mjs';

describe('nutrition capture ownership', () => {
  it('preserves first-use options and per-container capture service identity', () => {
    let decisionReads = 0;
    const options = {
      get decisionGateway() { decisionReads += 1; return null; },
      logger: { info() {}, warn() {}, error() {} },
    };
    const first = new NutribotContainer({}, options);
    const second = new NutribotContainer({}, options);
    expect(decisionReads).toBe(0);
    const firstReview = first.getFoodLogReview();
    expect(first.getFoodLogReview()).toBe(firstReview);
    expect(decisionReads).toBe(0);
    const firstChooser = first.getIconChooser();
    expect(decisionReads).toBe(1);
    expect(first.getIconChooser()).toBe(firstChooser);
    expect(decisionReads).toBe(1);
    expect(second.getFoodLogReview()).not.toBe(firstReview);
    expect(second.getIconChooser()).not.toBe(firstChooser);
    expect(decisionReads).toBe(2);
    expect(second.getIconChooser()).toBe(second.getIconChooser());
    expect(decisionReads).toBe(2);
  });
});
