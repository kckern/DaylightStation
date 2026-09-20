const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const PROMOTION_FAILURES = 3;
const PROMOTION_REVISIONS = 3;
const PROMOTION_TITLES = 2;
const PROMOTION_SUCCESSES = 2;
const DEMOTION_SUCCESSES = 3;

const uniqueBy = (items, key) => [...new Map(items.map(item => [item?.[key], item])).values()];
const sameScope = (outcome, scope) => outcome?.profileKey === scope?.profileKey && outcome?.environmentVersion === scope?.environmentVersion;
const decoderFailure = (outcome) => outcome?.attributedCause === 'decoder-incompatibility';
const provenCorrection = (outcome) => !outcome?.attributedCause && Boolean(outcome?.correction) && Number(outcome?.healthyDurationMs) > 0;

function inferredScope(rule, outcomes) {
  if (rule?.scope) return { ...rule.scope };
  const outcome = outcomes.find(item => item?.profileKey && item?.environmentVersion);
  return { profileKey: outcome?.profileKey || null, environmentVersion: outcome?.environmentVersion || null };
}

function patternPredicates(failures) {
  const media = failures.map(outcome => outcome.media || outcome.mediaCharacteristics || {});
  const codecs = [...new Set(media.map(item => String(item.codec || '').toLowerCase()).filter(Boolean))];
  const widths = media.map(item => Number(item.width)).filter(width => width >= 1920);
  const heights = media.map(item => Number(item.height)).filter(height => height >= 1080);
  return {
    ...(codecs.length ? { codec: codecs } : {}),
    ...(widths.length ? { minWidth: Math.min(...widths) } : {}),
    ...(!widths.length && heights.length ? { minHeight: Math.min(...heights) } : {}),
  };
}

function baseRule(rule, scope, failures, successes) {
  return {
    ...(rule || {}),
    scope,
    supportingIncidentIds: failures.map(outcome => outcome.incidentId),
    failureCount: failures.length,
    successCount: (rule?.successCount || 0) + successes.length,
  };
}

/**
 * Learns only attributable decoder patterns in one profile/environment scope.
 * It returns a new rule and has no persistence dependency.
 */
export function learnPlaybackRisk({ rule = null, outcomes = [], now }) {
  const scope = inferredScope(rule, outcomes);
  const scoped = outcomes.filter(outcome => sameScope(outcome, scope));
  const failures = uniqueBy(scoped.filter(decoderFailure), 'incidentId');
  const successes = uniqueBy(scoped.filter(provenCorrection), 'incidentId');
  const next = baseRule(rule, scope, failures, successes);

  if (rule?.status === 'active' && now >= rule.expiresAt) return { ...next, status: 'expired' };
  if (rule?.status === 'active' && successes.length >= DEMOTION_SUCCESSES) return { ...next, status: 'demoted' };
  if (rule?.status === 'active') {
    return {
      ...next,
      status: 'active',
      predicates: { ...(rule.predicates || {}) },
      expiresAt: rule.expiresAt,
    };
  }
  if (!failures.length) return { ...next, status: 'inactive', predicates: rule?.predicates || {} };

  const revisions = new Set(failures.map(outcome => outcome.sourceRevision).filter(Boolean));
  const titles = new Set(failures.map(outcome => outcome.titleId).filter(Boolean));
  const promotable = failures.length >= PROMOTION_FAILURES
    && revisions.size >= PROMOTION_REVISIONS
    && titles.size >= PROMOTION_TITLES
    && successes.length >= PROMOTION_SUCCESSES;
  if (promotable) {
    return { ...next, status: 'active', predicates: patternPredicates(failures), expiresAt: now + WEEK_MS };
  }

  const exact = failures[0];
  return {
    ...next,
    status: 'quarantined',
    predicates: { sourceRevision: exact.sourceRevision, titleId: exact.titleId },
    expiresAt: now + WEEK_MS,
  };
}

export default learnPlaybackRisk;
