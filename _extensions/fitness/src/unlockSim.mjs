// Pure selection logic for the hardware-free fingerprint unlock simulation.
//
// Given the candidate uuids supplied by the backend's unlock request, decide
// which candidate a simulated "match" should resolve to. Kept pure (no I/O, no
// WS, no env) so it can be unit-tested in isolation; server.mjs wires it into
// both the `auto-match` env path and the `POST /fingerprint/simulate` endpoint.

/**
 * Choose the simulated matching candidate.
 *
 * Selection priority:
 *   1. If `requestedUuid` is given and matches a candidate's uuid → that one.
 *   2. Else the first candidate whose uuid starts with `sim-`.
 *   3. Else the first candidate.
 *   4. Empty / null candidate list → null.
 *
 * @param {Array<{uuid: string, username: string}>|null|undefined} candidateUuids
 * @param {string} [requestedUuid] - optional explicit uuid to match.
 * @returns {{uuid: string, username: string}|null}
 */
export function selectSimCandidate(candidateUuids, requestedUuid) {
  if (!Array.isArray(candidateUuids) || candidateUuids.length === 0) {
    return null;
  }

  if (requestedUuid) {
    const requested = candidateUuids.find((c) => c && c.uuid === requestedUuid);
    if (requested) return requested;
  }

  const simCandidate = candidateUuids.find(
    (c) => c && typeof c.uuid === 'string' && c.uuid.startsWith('sim-')
  );
  if (simCandidate) return simCandidate;

  return candidateUuids[0];
}
