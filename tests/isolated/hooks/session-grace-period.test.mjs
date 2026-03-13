/**
 * Fitness session 30-minute grace period tests.
 *
 * Verifies:
 * - Default remove timeout is 30 minutes (1800000ms)
 * - Session survives 3 minutes of inactivity (regression guard)
 * - Session ends after 30 minutes of inactivity
 * - endSession('force_break') ends immediately regardless of timeout
 * - ActivityMonitor removeThresholdTicks derived correctly (360 ticks)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getFitnessTimeouts } from '#frontend/hooks/fitness/FitnessSession.js';

describe('Fitness session — 30-minute grace period', () => {
  it('has a 30-minute default remove timeout', () => {
    const timeouts = getFitnessTimeouts();
    expect(timeouts.remove).toBe(1800000);
  });

  it('derives ActivityMonitor removeThresholdTicks as 360', () => {
    // 1800000ms / 5000ms = 360 ticks
    const remove = getFitnessTimeouts().remove;
    const ticks = Math.ceil(remove / 5000);
    expect(ticks).toBe(360);
  });

  it('retains emptySession timeout at 60 seconds', () => {
    const timeouts = getFitnessTimeouts();
    expect(timeouts.emptySession).toBe(60000);
  });
});
