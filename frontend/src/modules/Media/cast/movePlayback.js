// A move is a two-owner transaction. The destination must publish positive
// adoption evidence before the source is even considered for stopping, and
// the source identity is checked again at that final boundary.

function sourceIdentity(snapshot) {
  const owner = snapshot?.meta?.playbackOwner;
  if (!owner || typeof owner.ownerInstanceId !== 'string'
    || !Number.isInteger(owner.playbackRevision)) return null;
  return { sourceOwnerId: owner.ownerInstanceId, sourceRevision: owner.playbackRevision };
}

export function createMoveRequest({ operationId, destinationId, snapshot, keepSource = false }) {
  const identity = sourceIdentity(snapshot);
  if (!identity) throw new TypeError('Move requires a captured playback-owner identity');
  if (typeof operationId !== 'string' || !operationId) throw new TypeError('Move requires operationId');
  if (typeof destinationId !== 'string' || !destinationId) throw new TypeError('Move requires destinationId');
  return {
    operationId,
    ...identity,
    destinationId,
    snapshot,
    keepSource: keepSource === true,
  };
}

function validResult(result) {
  return result && ['adopted', 'rejected', 'uncertain'].includes(result.status);
}

export async function executeMove(request, { source, destination }) {
  let adoption;
  try {
    adoption = await destination.adopt(request);
  } catch (error) {
    return { status: 'uncertain', reason: error?.message ?? 'destination-not-confirmed' };
  }
  if (!validResult(adoption)) return { status: 'uncertain', reason: 'invalid-destination-result' };
  if (adoption.status !== 'adopted' || request.keepSource) {
    return { ...adoption, sourceStopped: false };
  }

  const expected = {
    sourceOwnerId: request.sourceOwnerId,
    sourceRevision: request.sourceRevision,
  };
  const current = source.getIdentity?.();
  if (!current
    || current.sourceOwnerId !== expected.sourceOwnerId
    || current.sourceRevision !== expected.sourceRevision) {
    return { ...adoption, sourceStopped: false, reason: 'source-changed' };
  }
  const stopped = await source.stopIfCurrent?.(expected);
  const sourceStopped = stopped === true || stopped?.ok === true;
  return {
    ...adoption,
    sourceStopped,
    ...(!sourceStopped ? { reason: stopped?.code ?? 'source-not-stopped' } : {}),
  };
}

export default executeMove;
