import { describe, expect, it } from 'vitest';
import { learnPlaybackRisk } from './learnPlaybackRisk.mjs';

const scope = { profileKey: 'browser-a', environmentVersion: 'env-1' };
const failed = (incidentId, sourceRevision, titleId, correction = 'transcode') => ({
  incidentId, sourceRevision, titleId, profileKey: scope.profileKey, environmentVersion: scope.environmentVersion,
  media: { kind: 'video', codec: 'hevc', width: 1920, height: 804 }, attributedCause: 'decoder-incompatibility', correction, healthyDurationMs: 0, observedAt: 1_000,
});
const succeeded = (incidentId, sourceRevision, titleId, correction = 'transcode') => ({
  ...failed(incidentId, sourceRevision, titleId, correction), attributedCause: null, healthyDurationMs: 30_000,
});

describe('learnPlaybackRisk', () => {
  it('quarantines an exact item without promoting a one-item incident', () => {
    const next = learnPlaybackRisk({ rule: null, outcomes: [failed('i-1', 'r-1', 't-1')], now: 10_000 });
    expect(next).toMatchObject({ status: 'quarantined', scope, predicates: { sourceRevision: 'r-1', titleId: 't-1' }, supportingIncidentIds: ['i-1'] });
  });

  it('promotes only decoder evidence across three revisions, two titles, and two proven corrections', () => {
    const outcomes = [
      failed('i-1', 'r-1', 't-1', 'transcode'), failed('i-2', 'r-2', 't-1', 'direct-play'), failed('i-3', 'r-3', 't-2', 'transcode'),
      succeeded('s-1', 'r-1', 't-1', 'transcode'), succeeded('s-2', 'r-2', 't-1', 'direct-play'),
    ];
    const next = learnPlaybackRisk({ rule: null, outcomes, now: 10_000 });
    expect(next).toMatchObject({ status: 'active', scope, supportingIncidentIds: ['i-1', 'i-2', 'i-3'], failureCount: 3, successCount: 2, expiresAt: 604_810_000 });
    expect(next.predicates).toMatchObject({ codec: ['hevc'], minWidth: 1920 });
  });

  it('deduplicates incidents and counts only healthy correction successes as support', () => {
    const outcomes = [
      failed('i-1', 'r-1', 't-1'), failed('i-1', 'r-1', 't-1'), failed('i-2', 'r-2', 't-1'), failed('i-3', 'r-3', 't-2'),
      { ...succeeded('s-1', 'r-1', 't-1'), healthyDurationMs: 0 }, succeeded('s-2', 'r-2', 't-1'),
    ];
    expect(learnPlaybackRisk({ rule: null, outcomes, now: 10_000 })).toMatchObject({ status: 'quarantined', failureCount: 3, successCount: 1 });
  });

  it('never promotes network or unknown failures', () => {
    const outcomes = [
      { ...failed('i-1', 'r-1', 't-1'), attributedCause: 'network' },
      { ...failed('i-2', 'r-2', 't-1'), attributedCause: 'unknown' },
      { ...failed('i-3', 'r-3', 't-2'), attributedCause: 'network' },
      succeeded('s-1', 'r-1', 't-1'), succeeded('s-2', 'r-2', 't-1'),
    ];
    expect(learnPlaybackRisk({ rule: null, outcomes, now: 10_000 }).status).toBe('inactive');
  });

  it('invalidates evidence outside its profile and environment scope', () => {
    const outcomes = [
      failed('i-1', 'r-1', 't-1'), failed('i-2', 'r-2', 't-1'), failed('i-3', 'r-3', 't-2'), succeeded('s-1', 'r-1', 't-1'), succeeded('s-2', 'r-2', 't-1'),
      { ...failed('other', 'r-4', 't-3'), environmentVersion: 'env-2' },
    ];
    const next = learnPlaybackRisk({ rule: { scope: { profileKey: 'browser-a', environmentVersion: 'env-2' } }, outcomes, now: 10_000 });
    expect(next).toMatchObject({ status: 'quarantined', scope: { profileKey: 'browser-a', environmentVersion: 'env-2' }, failureCount: 1 });
  });

  it('demotes an active rule after three matching healthy successes', () => {
    const rule = { status: 'active', scope, predicates: { codec: ['hevc'], minWidth: 1920 }, supportingIncidentIds: ['i-1'], failureCount: 3, successCount: 2, expiresAt: 99_999 };
    const next = learnPlaybackRisk({ rule, outcomes: [succeeded('s-1', 'r-4', 't-4'), succeeded('s-2', 'r-5', 't-5'), succeeded('s-3', 'r-6', 't-6')], now: 10_000 });
    expect(next).toMatchObject({ status: 'demoted', successCount: 5 });
  });

  it('keeps an unexpired active rule active when a later attributable observation arrives', () => {
    const rule = { status: 'active', scope, predicates: { codec: ['hevc'], minWidth: 1920 }, supportingIncidentIds: ['i-1'], failureCount: 3, successCount: 2, expiresAt: 99_999 };
    const next = learnPlaybackRisk({ rule, outcomes: [failed('i-4', 'r-4', 't-3')], now: 10_000 });
    expect(next).toMatchObject({ status: 'active', supportingIncidentIds: ['i-4'], failureCount: 1, expiresAt: 99_999 });
  });

  it('leaves a rule inactive when there is no attributable evidence', () => {
    expect(learnPlaybackRisk({ rule: null, outcomes: [], now: 10_000 })).toMatchObject({ status: 'inactive', supportingIncidentIds: [], failureCount: 0, successCount: 0 });
  });
});
