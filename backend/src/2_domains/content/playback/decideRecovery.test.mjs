// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { advanceRecoveryLedger, decideRecovery } from './decideRecovery.mjs';
import { observation, original } from '../../../../../tests/fixtures/adaptive-playback/policyCases.mjs';

const ledger = { incidentCount: 0, replacementTimes: [], healthySince: null, lastReplacementAt: null };

describe('decideRecovery', () => {
  it('does not forgive three failures after one second of progress', () => {
    const prior = { incidentCount: 3, replacementTimes: [1000, 5000, 9000], healthySince: 10000, lastReplacementAt: 9000 };
    expect(advanceRecoveryLedger({ ledger: prior, now: 11000, healthy: true, replaced: false }).incidentCount).toBe(3);
  });

  it.each([
    ['waits when no observations arrived', [], ledger, [original], 1000, { action: 'wait', reason: 'await-observation' }],
    ['respects a paused player', [observation({ paused: true })], ledger, [original], 1000, { action: 'wait', reason: 'paused' }],
    ['respects a seeking player', [observation({ seeking: true })], ledger, [original], 1000, { action: 'wait', reason: 'seeking' }],
    ['renews expiring access', [observation({ failure: { kind: 'access-expired' }, positionMs: 12000 })], ledger, [original], 1000, { action: 'renew', reason: 'access-expired' }],
    ['replaces a decoder-rejected rendition with an eligible candidate', [observation({ failure: { kind: 'decoder' } })], ledger, [{ ...original, renditionId: 'safe-h264' }], 1000, { action: 'replace', reason: 'decoder-rejected', renditionId: 'safe-h264' }, 'original-h264'],
    ['prepares when ordered buffers fall while production cannot sustain delivery', [observation({ sequence: 2, observedAt: 2000, bufferSeconds: 2, productionRate: 0.5, deliveryRate: 1 }), observation({ sequence: 1, observedAt: 1000, bufferSeconds: 8, productionRate: 1, deliveryRate: 1 })], ledger, [], 2000, { action: 'prepare', reason: 'production-behind' }],
    ['keeps missing production evidence unknown even with a falling buffer', [observation({ sequence: 1, observedAt: 1000, bufferSeconds: 8 }), observation({ sequence: 2, observedAt: 2000, bufferSeconds: 2 })], ledger, [], 2000, { action: 'wait', reason: 'cause-unknown' }],
    ['fails after the thirty-second observed incident history', [observation({ observedAt: 0, failure: { kind: 'network' } }), observation({ sequence: 2, observedAt: 30000, failure: { kind: 'network' } })], ledger, [original], 30000, { action: 'fail', reason: 'incident-deadline-exceeded' }],
    ['starts the deadline at the first incident observation rather than earlier healthy history', [observation({ observedAt: 0 }), observation({ sequence: 2, observedAt: 20000, failure: { kind: 'network' } }), observation({ sequence: 3, observedAt: 30000, failure: { kind: 'network' } })], ledger, [original], 30000, { action: 'wait', reason: 'transient-backoff' }],
  ])('%s', (_name, observations, prior, candidates, now, expected, activeRenditionId) => {
    expect(decideRecovery({ observations, ledger: prior, candidates, now, activeRenditionId })).toEqual(expected);
  });

  it('applies the sixty-second healthy reset before evaluating the incident cap but retains the rolling cap', () => {
    const prior = { incidentCount: 3, replacementTimes: [1000, 5000], healthySince: 1000, lastReplacementAt: 5000 };
    expect(decideRecovery({ observations: [observation({ observedAt: 60000, failure: { kind: 'decoder' } })], ledger: prior, candidates: [{ ...original, renditionId: 'safe-h264' }], now: 61000, activeRenditionId: 'original-h264' }))
      .toEqual({ action: 'replace', reason: 'decoder-rejected', renditionId: 'safe-h264' });
  });

  it.each([
    ['decoder', [observation({ failure: { kind: 'decoder' } })], 1_000],
    ['production starvation', [observation({ sequence: 1, observedAt: 1_000, bufferSeconds: 8, productionRate: 1, deliveryRate: 1 }), observation({ sequence: 2, observedAt: 2_000, bufferSeconds: 2, productionRate: 0.5, deliveryRate: 1 })], 2_000],
    ['transient failure', [observation({ observedAt: 1_000, failure: { kind: 'network' } })], 2_000],
  ])('selects the stable lowest-cost distinct alternative for %s', (_name, observations, now) => {
    const active = { ...original, renditionId: 'active-h264', estimatedUnits: 0 };
    const later = { ...original, renditionId: 'later-h264', estimatedUnits: 2 };
    const preferred = { ...original, renditionId: 'preferred-h264', estimatedUnits: 1 };
    expect(decideRecovery({ observations, ledger, candidates: [later, active, preferred], now, activeRenditionId: 'active-h264' }).renditionId)
      .toBe('preferred-h264');
  });

  it.each([
    ['only active candidate', 'active-h264', [{ ...original, renditionId: 'active-h264' }]],
    ['missing active candidate identity', undefined, [{ ...original, renditionId: 'active-h264' }, { ...original, renditionId: 'safe-h264' }]],
    ['invalid active candidate identity', '', [{ ...original, renditionId: 'active-h264' }, { ...original, renditionId: 'safe-h264' }]],
  ])('never claims replacement when %s', (_name, activeRenditionId, candidates) => {
    const cases = [
      [ [observation({ failure: { kind: 'decoder' } })], 1_000 ],
      [ [observation({ sequence: 1, observedAt: 1_000, bufferSeconds: 8, productionRate: 1, deliveryRate: 1 }), observation({ sequence: 2, observedAt: 2_000, bufferSeconds: 2, productionRate: 0.5, deliveryRate: 1 })], 2_000 ],
      [ [observation({ observedAt: 1_000, failure: { kind: 'network' } })], 2_000 ],
    ];
    for (const [observations, now] of cases) {
      expect(decideRecovery({ observations, ledger, candidates, now, activeRenditionId }).action).toBe('prepare');
    }
  });

  it('records exactly one accepted replacement without mutating or resetting the rolling cap', () => {
    const prior = { incidentCount: 2, replacementTimes: [1000, 2000], healthySince: 0, lastReplacementAt: 2000 };
    const next = advanceRecoveryLedger({ ledger: prior, now: 61000, healthy: true, replaced: true });
    expect(next).toEqual({ incidentCount: 1, replacementTimes: [1000, 2000, 61000], healthySince: 0, lastReplacementAt: 61000 });
    expect(prior.replacementTimes).toEqual([1000, 2000]);
  });
});
