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
  it('does not count unresolved challenges (abandoned, started, cleared, replaced) as attempted or failed', () => {
    const events = ['abandoned', 'started', 'cleared', 'replaced', 'ended'].map((result) => ({ type: 'challenge', data: { result } }));
    expect(buildSessionSummary({ events, intervalSeconds: 5 }).challenges).toEqual({ total: 0, succeeded: 0, failed: 0 });
  });
  it('counts success and failed alongside an abandoned challenge', () => {
    const events = [
      { type: 'challenge', data: { result: 'success' } },
      { type: 'challenge', data: { result: 'failed' } },
      { type: 'challenge', data: { result: 'abandoned' } },
    ];
    expect(buildSessionSummary({ events, intervalSeconds: 5 }).challenges).toEqual({ total: 2, succeeded: 1, failed: 1 });
  });
});
