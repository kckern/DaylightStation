/** Owner-held identity. Renderer and intent tokens validate work; only owner/visit scope budgets. */
let nextVisit = 0;
const fields = ['ownerId', 'visitId', 'intentRevision', 'rendererGeneration'];
export const sameRecoveryTarget = (a, b) => !!a && !!b && fields.every(key => a[key] === b[key]);
export const recoverySessionKey = (target) => target ? `${target.ownerId}:${target.visitId}` : null;

export function createRecoveryIdentity({ ownerId, createVisitId = () => `visit-${++nextVisit}` }) {
  if (!ownerId) throw new Error('Recovery identity requires an ownerId');
  let target = Object.freeze({ ownerId, visitId: createVisitId(), intentRevision: 0, rendererGeneration: 0 });
  let disposed = false;
  const listeners = new Set();
  const publish = (changes) => {
    if (disposed) return null;
    target = Object.freeze({ ...target, ...changes });
    for (const listener of [...listeners]) listener(target);
    return target;
  };
  return {
    getTarget: () => target,
    beginVisit: () => publish({ visitId: createVisitId(), intentRevision: target.intentRevision + 1, rendererGeneration: target.rendererGeneration + 1 }),
    acceptUserIntent: () => publish({ intentRevision: target.intentRevision + 1, rendererGeneration: target.rendererGeneration + 1 }),
    beginRenderer: (expectedTarget) => {
      if (disposed || (expectedTarget && !sameRecoveryTarget(expectedTarget, target))) return null;
      return publish({ rendererGeneration: target.rendererGeneration + 1 });
    },
    invalidateRenderer: () => publish({ rendererGeneration: target.rendererGeneration + 1 }),
    subscribe: (listener) => { if (!disposed) listeners.add(listener); return () => listeners.delete(listener); },
    dispose: () => { disposed = true; listeners.clear(); },
  };
}
