import { describe, it, expect } from 'vitest';
import { GovernanceEngine } from './GovernanceEngine.js';

const zoneRankMap = { cool: 0, active: 1, warm: 2, hot: 3 };
const zoneInfoMap = Object.fromEntries(Object.keys(zoneRankMap).map(id => [id, { id, name: id }]));
function harness() {
  let now = 100000;
  const roster = [{ id: 'child', heartRate: 165 }];
  const session = { roster, zoneProfileStore: { getProfile: () => ({ zoneConfig: [{ id: 'hot', min: 160 }, { id: 'warm', min: 140 }, { id: 'active', min: 120 }] }) } };
  const engine = new GovernanceEngine(null, { now: () => now, random: () => 0 });
  engine.session = session;
  engine.configure({ governed_labels: ['cardio'], superusers: ['parent'], policies: { default: { base_requirement: [{ active: 'all' }], challenges: [] } }, zoneConfig: Object.values(zoneInfoMap) });
  engine.setMedia({ id: 'video:1', labels: ['cardio'], type: 'episode' });
  const evaluate = zone => engine.evaluate({ activeParticipants: ['child'], userZoneMap: { child: zone }, totalCount: 1, zoneRankMap, zoneInfoMap });
  return { engine, roster, evaluate, advance: ms => { now += ms; } };
}
describe('historical governance evidence', () => {
  it('snapshots the actual startup achiever, HR and threshold without later mutation', () => {
    const h = harness(); h.evaluate('active'); h.evaluate('hot');
    const proof = h.engine.state.playbackEvidence;
    expect(proof).toMatchObject({ participantId: 'child', zone: 'hot', hrBpm: 165, thresholdBpm: 160, reason: 'startup_gate' });
    h.roster[0].heartRate = 100; h.evaluate('cool');
    expect(proof.hrBpm).toBe(165);
  });
  it('records challenge failure and replaces the failure evidence on recovery', () => {
    const h = harness(); h.evaluate('hot'); h.advance(180000); h.evaluate('active');
    h.advance(91000); h.evaluate('active');
    expect(h.engine.state.playbackEvidence).toMatchObject({ reason: 'challenge_failed', challengeId: expect.any(String), requiredZone: 'warm', requiredThresholdBpm: 140 });
    h.roster[0].heartRate = 145; h.evaluate('warm'); h.advance(100); h.evaluate('warm');
    expect(h.engine.state.playbackEvidence.reason).not.toBe('challenge_failed');
  });
});


it('attributes a warning to the participant below the requirement instead of the first roster member', () => {
  const h = harness(); h.engine.config.grace_period_seconds = 30;
  const evaluate = zone => h.engine.evaluate({ activeParticipants: ['other-child', 'child'], userZoneMap: { 'other-child': 'hot', child: zone }, totalCount: 2, zoneRankMap, zoneInfoMap });
  evaluate('active'); evaluate('cool');
  expect(h.engine.phase).toBe('warning');
  expect(h.engine.state.playbackEvidence).toMatchObject({ participantId: 'child', requiredZone: 'active', requiredThresholdBpm: 120 });
});
