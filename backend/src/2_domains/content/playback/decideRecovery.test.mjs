// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { advanceRecoveryLedger, decideRecovery } from './decideRecovery.mjs';
import { original } from '../../../../../tests/fixtures/adaptive-playback/policyCases.mjs';

const ledger = { incidentCount: 0, replacementTimes: [], healthySince: null, lastReplacementAt: null };

describe('decideRecovery', () => {
  it('does not forgive three failures after one second of progress', () => {
    const prior = { incidentCount: 3, replacementTimes: [1000, 5000, 9000], healthySince: 10000, lastReplacementAt: 9000 };
    expect(advanceRecoveryLedger({ ledger: prior, now: 11000, healthy: true, replaced: false }).incidentCount).toBe(3);
  });

  it.each([
    ['waits when no observations arrived', [], ledger, [original], 1000, { action: 'wait', reason: 'await-observation' }],
    ['respects a paused player', [{ paused: true }], ledger, [original], 1000, { action: 'wait', reason: 'paused' }],
    ['respects a seeking player', [{ seeking: true }], ledger, [original], 1000, { action: 'wait', reason: 'seeking' }],
    ['renews expiring access', [{ failure: { kind: 'access-expired' }, positionMs: 12000 }], ledger, [original], 1000, { action: 'renew', reason: 'access-expired' }],
    ['replaces a decoder-rejected rendition with a distinct candidate', [{ failure: { kind: 'decoder' }, renditionId: 'original-h264' }], ledger, [{ ...original, renditionId: 'safe-h264' }], 1000, { action: 'replace', reason: 'decoder-rejected', renditionId: 'safe-h264' }],
    ['prepares when the buffer falls while production cannot sustain playback', [{ bufferSeconds: 2, previousBufferSeconds: 8, productionRate: 0.5, deliveryRate: 1 }], ledger, [], 1000, { action: 'prepare', reason: 'production-behind' }],
    ['does not infer encoder starvation from CPU alone', [{ cpuPercent: 100, bufferSeconds: 8 }], ledger, [], 1000, { action: 'wait', reason: 'cause-unknown' }],
    ['fails after the thirty-second incident deadline', [{ failure: { kind: 'network' }, incidentStartedAt: 0 }], ledger, [original], 30001, { action: 'fail', reason: 'incident-deadline-exceeded' }],
    ['does not wait beyond the exact thirty-second incident deadline', [{ failure: { kind: 'network' }, incidentStartedAt: 0 }], ledger, [original], 30000, { action: 'fail', reason: 'incident-deadline-exceeded' }],
  ])('%s', (_name, observations, prior, candidates, now, expected) => {
    expect(decideRecovery({ observations, ledger: prior, candidates, now })).toEqual(expected);
  });

  it('records exactly one accepted replacement without mutating or resetting the rolling cap', () => {
    const prior = { incidentCount: 2, replacementTimes: [1000, 2000], healthySince: 0, lastReplacementAt: 2000 };
    const next = advanceRecoveryLedger({ ledger: prior, now: 61000, healthy: true, replaced: true });
    expect(next).toEqual({ incidentCount: 1, replacementTimes: [1000, 2000, 61000], healthySince: 0, lastReplacementAt: 61000 });
    expect(prior.replacementTimes).toEqual([1000, 2000]);
  });
});
