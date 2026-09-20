import { describe, expect, it } from 'vitest';
import { decideAssessment } from './assessmentTrigger.mjs';

const seededVideo = {
  kind: 'video', codec: 'hevc', width: 1920, height: 804,
  sourceRevision: 'source-a', titleId: 'title-a',
};
const scope = { profileKey: 'browser-a', environmentVersion: 'env-1' };

describe('decideAssessment', () => {
  it('keeps ordinary video optimistic by default', () => {
    expect(decideAssessment({media:{kind:'video'},clientProfileKey:'browser-a',
      cachedRisk:[],episodes:[],failure:null,now:1000})).toEqual({action:'play',reason:'optimistic-default'});
  });

  it('always bypasses assessment for audio', () => {
    expect(decideAssessment({media:{kind:'audio',codec:'aac'},clientProfileKey:'browser-a',
      cachedRisk:[],episodes:[],failure:null,now:1000}).action).toBe('play');
  });

  it('assesses a video cache seed only when its codec and either dimension qualify', () => {
    expect(decideAssessment({ media: seededVideo, clientProfileKey: 'browser-a', cachedRisk: [], episodes: [], failure: null, now: 1000 }))
      .toEqual({ action: 'assess', reason: 'seed-risk' });
    expect(decideAssessment({ media: { ...seededVideo, codec: 'h264' }, clientProfileKey: 'browser-a', cachedRisk: [], episodes: [], failure: null, now: 1000 }).action).toBe('play');
    expect(decideAssessment({ media: { ...seededVideo, width: 719, height: 720 }, clientProfileKey: 'browser-a', cachedRisk: [], episodes: [], failure: null, now: 1000 }).action).toBe('play');
  });

  it('matches cropped and portrait qualifying video but not 720p or unknown dimensions', () => {
    for (const media of [
      seededVideo,
      { ...seededVideo, width: 800, height: 1920 },
    ]) {
      expect(decideAssessment({ media, clientProfileKey: 'browser-a', cachedRisk: [], episodes: [], failure: null, now: 1000 }).reason).toBe('seed-risk');
    }
    for (const media of [
      { ...seededVideo, width: 1280, height: 720 },
      { ...seededVideo, width: undefined, height: undefined },
    ]) {
      expect(decideAssessment({ media, clientProfileKey: 'browser-a', cachedRisk: [], episodes: [], failure: null, now: 1000 }).action).toBe('play');
    }
  });

  it('does not reassess a seeded source with compatible evidence in this profile scope', () => {
    const compatible = {
      profileKey: 'browser-a', environmentVersion: 'env-1', sourceRevision: 'source-a',
      correction: 'video', attributedCause: null, healthyDurationMs: 30_000,
    };
    expect(decideAssessment({ media: { ...seededVideo, environmentVersion: 'env-1' }, clientProfileKey: 'browser-a', cachedRisk: [compatible], episodes: [], failure: null, now: 1000 }))
      .toEqual({ action: 'play', reason: 'known-compatible' });
  });

  it('does not let compatible evidence from another environment suppress a seed match', () => {
    const compatibleElsewhere = {
      profileKey: 'browser-a', environmentVersion: 'env-2', sourceRevision: 'source-a',
      correction: 'video', attributedCause: null, healthyDurationMs: 30_000,
    };
    expect(decideAssessment({ media: { ...seededVideo, environmentVersion: 'env-1' }, clientProfileKey: 'browser-a', cachedRisk: [compatibleElsewhere], episodes: [], failure: null, now: 1000 }))
      .toEqual({ action: 'assess', reason: 'seed-risk' });
  });

  it('assesses only an active learned rule that matches the media and profile', () => {
    const rule = {
      status: 'active', scope: { profileKey: 'browser-a', environmentVersion: 'env-1' },
      predicates: { codec: ['hevc'], minWidth: 1920 }, expiresAt: 2_000,
    };
    expect(decideAssessment({ media: { ...seededVideo, environmentVersion: 'env-1' }, clientProfileKey: 'browser-a', cachedRisk: [rule], episodes: [], failure: null, now: 1000 }))
      .toEqual({ action: 'assess', reason: 'learned-risk' });
    expect(decideAssessment({ media: { kind: 'video', codec: 'h264' }, clientProfileKey: 'browser-b', cachedRisk: [rule], episodes: [], failure: null, now: 1000 }).action).toBe('play');
  });

  it('does not assess expired rules, rules without an environment, or metadata-free rules', () => {
    const active = {
      status: 'active', scope, predicates: { codec: ['h264'] }, expiresAt: 1,
    };
    expect(decideAssessment({ media: { kind: 'video', codec: 'h264', environmentVersion: 'env-1' }, clientProfileKey: 'browser-a', cachedRisk: [active], episodes: [], failure: null, now: 2 }).action).toBe('play');
    expect(decideAssessment({ media: { kind: 'video', codec: 'h264' }, clientProfileKey: 'browser-a', cachedRisk: [{ ...active, expiresAt: 2_000 }], episodes: [], failure: null, now: 1_000 }).action).toBe('play');
    expect(decideAssessment({ media: { kind: 'video', codec: 'h264', environmentVersion: 'env-1' }, clientProfileKey: 'browser-a', cachedRisk: [{ ...active, expiresAt: undefined }], episodes: [], failure: null, now: 1_000 }).action).toBe('play');
    expect(decideAssessment({ media: { kind: 'video', codec: 'h264', environmentVersion: 'env-1' }, clientProfileKey: 'browser-a', cachedRisk: [{ ...active, expiresAt: 2_000, predicates: {} }], episodes: [], failure: null, now: 1_000 }).action).toBe('play');
  });

  it('escalates a definitive decoder failure and the independent first-stall timeout', () => {
    for (const failure of [{ kind: 'decoder-incompatibility' }, { kind: 'first-stall-timeout' }]) {
      expect(decideAssessment({ media: { kind: 'video', codec: 'h264' }, clientProfileKey: 'browser-a', cachedRisk: [], episodes: [], failure, now: 1000 }).action).toBe('assess');
    }
  });

  it('escalates two episode starts in the last two minutes', () => {
    const episodes = [{ startedAt: 10 }, { startedAt: 120_000 }];
    expect(decideAssessment({ media: { kind: 'video', codec: 'h264' }, clientProfileKey: 'browser-a', cachedRisk: [], episodes, failure: null, now: 120_010 }))
      .toEqual({ action: 'assess', reason: 'repeated-interruptions' });
  });

  it('does not re-emit an episode assessment after its immutable state is consumed', () => {
    const episodes = [{ startedAt: 10 }, { startedAt: 120_000, assessmentConsumedAt: 120_010 }];
    expect(decideAssessment({ media: { kind: 'video', codec: 'h264' }, clientProfileKey: 'browser-a', cachedRisk: [], episodes, failure: null, now: 120_010 }))
      .toEqual({ action: 'play', reason: 'optimistic-default' });
  });
});
