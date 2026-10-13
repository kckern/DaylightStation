import { describe, expect, it } from 'vitest';
import { buildSessionSummary } from './buildSessionSummary.js';
const cancelled = { type: 'challenge_cancelled', data: { type: 'cycle', reason: 'sensor_offline' } };
describe('neutral challenge cancellation summaries', () => {
  it('does not count a sensor cancellation as an attempted or failed challenge', () => {
    expect(buildSessionSummary({ events: [cancelled], intervalSeconds: 5 }).challenges).toEqual({ total: 0, succeeded: 0, failed: 0 });
  });
  it('counts only an ordinary failure alongside a sensor cancellation', () => {
    expect(buildSessionSummary({ events: [{ type: 'challenge', data: { result: 'failed' } }, cancelled], intervalSeconds: 5 }).challenges).toEqual({ total: 1, succeeded: 0, failed: 1 });
  });
});
