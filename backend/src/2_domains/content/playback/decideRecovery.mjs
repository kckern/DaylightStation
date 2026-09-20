import { validateObservation, validateRecoveryLedger, validateRendition } from './contracts.mjs';

const INCIDENT_DEADLINE_MS = 30_000;
const ROLLING_REPLACEMENT_MS = 600_000;
const RECOVERY_MS = 60_000;
const backoffFor = incidents => [1_000, 2_000, 4_000][Math.min(Math.max(incidents, 0), 2)];
const finite = value => Number.isFinite(value);

function normalizedObservations(observations) {
  if (observations == null) return [];
  if (!Array.isArray(observations)) throw new TypeError('observations must be an array');
  return observations.map(validateObservation)
    .sort((a, b) => a.observedAt - b.observedAt || a.sequence - b.sequence);
}

function nextCandidate(candidates) {
  if (!Array.isArray(candidates)) throw new TypeError('candidates must be an array');
  return candidates.map(validateRendition)
    .filter(candidate => candidate.ready)
    .sort((left, right) => (left.estimatedUnits ?? 0) - (right.estimatedUnits ?? 0) || String(left.renditionId).localeCompare(String(right.renditionId)))[0];
}

function deadlineExceeded(observations, now) {
  const firstIncident = observations.find(observation => observation.failure !== null) || observations[0];
  return firstIncident !== undefined && now - firstIncident.observedAt >= INCIDENT_DEADLINE_MS;
}

function productionBehind(observations) {
  if (observations.length < 2) return false;
  const previous = observations.at(-2);
  const latest = observations.at(-1);
  const bufferFalling = finite(previous.bufferSeconds) && finite(latest.bufferSeconds)
    && latest.bufferSeconds < previous.bufferSeconds;
  const production = latest.productionRate;
  const consumption = latest.deliveryRate;
  return bufferFalling && finite(production) && finite(consumption) && production < consumption;
}

function recoveredIncidentCount(ledger, now) {
  return ledger.healthySince !== null && now - ledger.healthySince >= RECOVERY_MS ? 0 : ledger.incidentCount;
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
  const exhausted = recoveredIncidentCount(current, now) >= 3 || recent.length >= 6;
  const failure = latest.failure || {};
  if (failure.kind === 'access-expired') {
    return exhausted ? { action: 'fail', reason: 'replacement-budget-exhausted' } : { action: 'renew', reason: 'access-expired' };
  }
  if (exhausted) return { action: 'fail', reason: 'replacement-budget-exhausted' };
  if (failure.kind === 'decoder') {
    const replacement = nextCandidate(candidates);
    return replacement ? { action: 'replace', reason: 'decoder-rejected', renditionId: replacement.renditionId } : { action: 'prepare', reason: 'no-compatible-replacement' };
  }
  if (productionBehind(facts)) {
    const replacement = nextCandidate(candidates);
    return replacement ? { action: 'replace', reason: 'production-behind', renditionId: replacement.renditionId } : { action: 'prepare', reason: 'production-behind' };
  }
  if (['network', 'provider', 'unknown'].includes(failure.kind)) {
    if (now - latest.observedAt < backoffFor(recoveredIncidentCount(current, now))) return { action: 'wait', reason: 'transient-backoff' };
    const replacement = nextCandidate(candidates);
    return replacement ? { action: 'replace', reason: 'transient-recovery', renditionId: replacement.renditionId } : { action: 'prepare', reason: 'no-supported-recovery' };
  }
  return { action: 'wait', reason: 'cause-unknown' };
}

export default decideRecovery;
