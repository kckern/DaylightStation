const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const PROMOTION_FAILURES = 3;
const PROMOTION_REVISIONS = 3;
const PROMOTION_TITLES = 2;
const PROMOTION_SUCCESSES = 2;
const DEMOTION_SUCCESSES = 3;

const uniqueBy = (items, key) => [...new Map(items.map(item => [item?.[key], item])).values()];
const mergeIds = (existing, incoming) => [...new Set([...(existing || []), ...incoming])];
const sameScope = (outcome, scope) => outcome?.profileKey === scope?.profileKey && outcome?.environmentVersion === scope?.environmentVersion;
const decoderFailure = (outcome) => outcome?.attributedCause === 'decoder-incompatibility';
const provenCorrection = (outcome) => !outcome?.attributedCause && Boolean(outcome?.correction) && Number(outcome?.healthyDurationMs) > 0;
const healthySuccess = (outcome) => !outcome?.attributedCause && Number(outcome?.healthyDurationMs) > 0;

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
  const predicates = {
    ...(codecs.length ? { codec: codecs } : {}),
    ...(widths.length ? { minWidth: Math.min(...widths) } : {}),
    ...(!widths.length && heights.length ? { minHeight: Math.min(...heights) } : {}),
  };
  return Object.keys(predicates).length ? predicates : null;
}

function baseRule(rule, scope, failures, successes) {
  const failureIds = mergeIds(rule?.supportingIncidentIds, failures.map(outcome => outcome.incidentId));
  const successIds = mergeIds(rule?.supportingSuccessIds, successes.map(outcome => outcome.incidentId));
  return {
    ...(rule || {}),
    scope,
    supportingIncidentIds: failureIds,
    supportingSuccessIds: successIds,
    failureCount: rule?.supportingIncidentIds ? failureIds.length : Math.max(rule?.failureCount || 0, failureIds.length),
    successCount: rule?.supportingSuccessIds ? successIds.length : Math.max(rule?.successCount || 0, successIds.length),
  };
}

function matchesPredicates(predicates, outcome) {
  const media = outcome?.media || outcome?.mediaCharacteristics || {};
  if (!Object.values(predicates || {}).some(value => Array.isArray(value) ? value.length : value != null && value !== '')) return false;
  const codecs = predicates.codec || predicates.codecs;
  if (codecs && ![].concat(codecs).map(codec => String(codec).toLowerCase()).includes(String(media.codec || '').toLowerCase())) return false;
  if (predicates.sourceRevision && predicates.sourceRevision !== outcome.sourceRevision) return false;
  if (predicates.titleId && predicates.titleId !== outcome.titleId) return false;
  if (predicates.minWidth && Number(media.width) < predicates.minWidth) return false;
  if (predicates.minHeight && Number(media.height) < predicates.minHeight) return false;
  return true;
}

function laterOriginalSuccesses(rule, outcomes) {
  return uniqueBy(outcomes.filter(outcome => healthySuccess(outcome)
    && outcome.correction == null
    && Number(outcome.observedAt) > Number(rule.activatedAt)
    && matchesPredicates(rule.predicates, outcome)), 'incidentId');
}

/**
 * Learns only attributable decoder patterns in one profile/environment scope.
 * It returns a new rule and has no persistence dependency.
 */
export function learnPlaybackRisk({ rule = null, outcomes = [], now }) {
  const scope = inferredScope(rule, outcomes);
  const scoped = outcomes.filter(outcome => sameScope(outcome, scope));
  const failures = uniqueBy(scoped.filter(decoderFailure), 'incidentId');
  const successes = uniqueBy(scoped.filter(healthySuccess), 'incidentId');
  const correctionSuccesses = successes.filter(provenCorrection);
  const next = baseRule(rule, scope, failures, successes);

  if (rule?.status === 'active' && now >= rule.expiresAt) return { ...next, status: 'expired' };
  if (rule?.status === 'active') {
    const demotionSuccessIds = mergeIds(rule.demotionSuccessIds, laterOriginalSuccesses(rule, scoped).map(outcome => outcome.incidentId));
    return {
      ...next,
      status: demotionSuccessIds.length >= DEMOTION_SUCCESSES ? 'demoted' : 'active',
      predicates: { ...(rule.predicates || {}) },
      expiresAt: rule.expiresAt,
      demotionSuccessIds,
    };
  }
  if (!failures.length) return { ...next, status: 'inactive', predicates: rule?.predicates || {} };

  const revisions = new Set(failures.map(outcome => outcome.sourceRevision).filter(Boolean));
  const titles = new Set(failures.map(outcome => outcome.titleId).filter(Boolean));
  const promotable = failures.length >= PROMOTION_FAILURES
    && revisions.size >= PROMOTION_REVISIONS
    && titles.size >= PROMOTION_TITLES
    && correctionSuccesses.length >= PROMOTION_SUCCESSES;
  const predicates = patternPredicates(failures);
  if (promotable && predicates) {
    return { ...next, status: 'active', predicates, activatedAt: now, expiresAt: now + WEEK_MS, demotionSuccessIds: [] };
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
