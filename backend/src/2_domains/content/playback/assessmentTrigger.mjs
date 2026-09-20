const SEED_CODECS = new Set(['hevc', 'vp9', 'av1']);
const TWO_MINUTES = 120_000;

const play = (reason) => ({ action: 'play', reason });
const assess = (reason) => ({ action: 'assess', reason });

function cachedEntries(cachedRisk) {
  if (Array.isArray(cachedRisk)) return cachedRisk;
  return [...(cachedRisk?.rules || []), ...(cachedRisk?.outcomes || [])];
}

function isSeedRisk(media) {
  if (media?.kind !== 'video' || !SEED_CODECS.has(String(media.codec || '').toLowerCase())) return false;
  return Number(media.width) >= 1920 || Number(media.height) >= 1080;
}

function hasRiskPredicate(predicates) {
  return Object.values(predicates || {}).some(value => Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== '');
}

function matchesRule(rule, media, clientProfileKey, now) {
  if (rule?.status !== 'active' || rule.scope?.profileKey !== clientProfileKey) return false;
  if (!Number.isFinite(rule.expiresAt) || rule.expiresAt <= now || rule.scope?.environmentVersion !== media?.environmentVersion) return false;
  const predicates = rule.predicates || rule.featurePredicates || {};
  if (!hasRiskPredicate(predicates)) return false;
  const codecs = predicates.codec || predicates.codecs;
  if (codecs && ![].concat(codecs).map(codec => String(codec).toLowerCase()).includes(String(media?.codec || '').toLowerCase())) return false;
  if (predicates.sourceRevision && predicates.sourceRevision !== media?.sourceRevision) return false;
  if (predicates.titleId && predicates.titleId !== media?.titleId) return false;
  if (predicates.minWidth && Number(media?.width) < predicates.minWidth) return false;
  if (predicates.minHeight && Number(media?.height) < predicates.minHeight) return false;
  return true;
}

function hasCompatibleEvidence(entries, media, clientProfileKey) {
  return entries.some(entry => entry?.attributedCause == null
    && Boolean(entry?.correction)
    && entry.profileKey === clientProfileKey
    && entry.environmentVersion === media?.environmentVersion
    && entry.sourceRevision === media?.sourceRevision
    && Number(entry.healthyDurationMs) > 0);
}

function hasRepeatedEpisodes(episodes, now) {
  return (episodes || []).filter(episode => episode?.assessmentConsumedAt == null
    && Number(episode?.startedAt) >= now - TWO_MINUTES
    && Number(episode?.startedAt) <= now).length >= 2;
}

/**
 * Makes a local, cache-only decision. Calling this policy never probes a
 * provider or persists state; callers load cached facts away from playback's
 * start-critical path.
 */
export function decideAssessment({ media, clientProfileKey, cachedRisk = [], episodes = [], failure = null, now }) {
  if (media?.kind === 'audio') return play('audio-bypass');
  if (failure?.kind === 'decoder-incompatibility') return assess('decoder-incompatibility');
  if (failure?.kind === 'first-stall-timeout') return assess('first-stall-timeout');
  if (hasRepeatedEpisodes(episodes, now)) return assess('repeated-interruptions');

  const entries = cachedEntries(cachedRisk);
  if (entries.some(rule => matchesRule(rule, media, clientProfileKey, now))) return assess('learned-risk');
  if (isSeedRisk(media) && hasCompatibleEvidence(entries, media, clientProfileKey)) return play('known-compatible');
  if (isSeedRisk(media)) return assess('seed-risk');
  return play('optimistic-default');
}

export default decideAssessment;
