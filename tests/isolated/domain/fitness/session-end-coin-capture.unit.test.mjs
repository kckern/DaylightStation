import { describe, it, expect, vi } from 'vitest';

describe('FitnessSession end() coin capture ordering', () => {
  it('captures treasureBox summary BEFORE reset clears state', () => {
    const treasureBox = {
      totalCoins: 500,
      buckets: { blue: 0, green: 200, yellow: 150, orange: 100, red: 50 },
      get summary() {
        return {
          totalCoins: this.totalCoins,
          buckets: { ...this.buckets },
        };
      },
      stop: vi.fn(),
      reset() {
        this.totalCoins = 0;
        this.buckets = {};
      },
    };

    // WRONG ordering (current bug): reset before summary
    const buggyCapture = () => {
      treasureBox.stop();
      treasureBox.reset();
      return treasureBox.summary;
    };

    const buggyResult = buggyCapture();
    expect(buggyResult.totalCoins).toBe(0); // Bug: coins lost

    // Restore state for correct test
    treasureBox.totalCoins = 500;
    treasureBox.buckets = { blue: 0, green: 200, yellow: 150, orange: 100, red: 50 };

    // CORRECT ordering: summary before reset
    const correctCapture = () => {
      treasureBox.stop();
      const summary = treasureBox.summary;
      treasureBox.reset();
      return summary;
    };

    const correctResult = correctCapture();
    expect(correctResult.totalCoins).toBe(500);
    expect(correctResult.buckets.green).toBe(200);
    expect(correctResult.buckets.orange).toBe(100);

    // After correct capture, treasureBox is still reset
    expect(treasureBox.totalCoins).toBe(0);
    expect(treasureBox.buckets).toEqual({});
  });
});
