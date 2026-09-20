import { validateRecoveryLedger } from './contracts.mjs';

const INCIDENT_DEADLINE_MS = 30_000;
const ROLLING_REPLACEMENT_MS = 600_000;
const RECOVERY_MS = 60_000;
const backoffFor = incidents => [1_000, 2_000, 4_000][Math.min(Math.max(incidents, 0), 2)];
const finite = value => Number.isFinite(value);

function normalizedObservations(observations) {
  if (observations == null) return [];
  if (!Array.isArray(observations)) throw new TypeError('observations must be an array');
  return observations.slice().sort((a, b) => (a?.sequence ?? 0) - (b?.sequence ?? 0));
}

function nextCandidate(candidates, rejectedId) {
  return (candidates || [])
    .filter(candidate => candidate?.renditionId && candidate.renditionId !== rejectedId && candidate.ready !== false)
    .sort((left, right) => (left.estimatedUnits ?? 0) - (right.estimatedUnits ?? 0) || String(left.renditionId).localeCompare(String(right.renditionId)))[0];
}

function deadlineExceeded(observations, now) {
  return observations.some(observation => finite(observation?.incidentStartedAt) && now - observation.incidentStartedAt >= INCIDENT_DEADLINE_MS);
}

function productionBehind(observation) {
  const bufferFalling = finite(observation?.bufferSeconds) && finite(observation?.previousBufferSeconds)
    && observation.bufferSeconds < observation.previousBufferSeconds;
  const production = observation?.productionRate ?? observation?.conversionProductionRate;
  const consumption = observation?.deliveryRate ?? observation?.playbackRate ?? 1;
  return bufferFalling && finite(production) && finite(consumption) && production < consumption;
}

/**
 * Advances immutable state only after the owning application accepts a
 * replacement transition. Recovery and rolling caps deliberately have separate
 * lifetimes: sixty seconds of health clears an incident, never its ten-minute cap.
 */
export function advanceRecoveryLedger({ ledger, now, healthy, replaced }) {
  const current = validateRecoveryLedger(ledger);
  if (!finite(now)) throw new TypeError('now must be a finite timestamp');
  const healthySince = healthy ? (current.healthySince ?? now) : null;
  const recovered = healthySince !== null && now - healthySince >= RECOVERY_MS;
  const incidentCount = (recovered ? 0 : current.incidentCount) + (replaced ? 1 : 0);
  return {
    incidentCount,
    replacementTimes: replaced ? [...current.replacementTimes, now] : [...current.replacementTimes],
    healthySince,
    lastReplacementAt: replaced ? now : current.lastReplacementAt,
  };
}

/** Makes a deterministic recovery decision from normalized, correlated facts. */
export function decideRecovery({ observations = [], ledger, candidates = [], now }) {
  const current = validateRecoveryLedger(ledger);
  if (!finite(now)) throw new TypeError('now must be a finite timestamp');
  const facts = normalizedObservations(observations);
  if (!facts.length) return { action: 'wait', reason: 'await-observation' };
  const latest = facts.at(-1) || {};
  if (latest.paused) return { action: 'wait', reason: 'paused' };
  if (latest.seeking) return { action: 'wait', reason: 'seeking' };
  if (deadlineExceeded(facts, now)) return { action: 'fail', reason: 'incident-deadline-exceeded' };

  const recent = current.replacementTimes.filter(at => now - at < ROLLING_REPLACEMENT_MS);
  const exhausted = current.incidentCount >= 3 || recent.length >= 6;
  const failure = latest.failure || {};
  if (failure.kind === 'access-expired' || (finite(latest.expiresAt) && latest.expiresAt <= now) || (finite(latest.delivery?.expiresAt) && latest.delivery.expiresAt <= now)) {
    return exhausted ? { action: 'fail', reason: 'replacement-budget-exhausted' } : { action: 'renew', reason: 'access-expired' };
  }
  if (exhausted) return { action: 'fail', reason: 'replacement-budget-exhausted' };
  if (failure.kind === 'decoder') {
    const replacement = nextCandidate(candidates, latest.renditionId);
    return replacement ? { action: 'replace', reason: 'decoder-rejected', renditionId: replacement.renditionId } : { action: 'prepare', reason: 'no-compatible-replacement' };
  }
  if (productionBehind(latest)) {
    const replacement = nextCandidate(candidates, latest.renditionId);
    return replacement ? { action: 'replace', reason: 'production-behind', renditionId: replacement.renditionId } : { action: 'prepare', reason: 'production-behind' };
  }
  if (['network', 'provider', 'unknown'].includes(failure.kind)) {
    const observedAt = latest.observedAt ?? latest.incidentStartedAt ?? now;
    if (now - observedAt < backoffFor(current.incidentCount)) return { action: 'wait', reason: 'transient-backoff' };
    const replacement = nextCandidate(candidates, latest.renditionId);
    return replacement ? { action: 'replace', reason: 'transient-recovery', renditionId: replacement.renditionId } : { action: 'prepare', reason: 'no-supported-recovery' };
  }
  return { action: 'wait', reason: 'cause-unknown' };
}

export default decideRecovery;
