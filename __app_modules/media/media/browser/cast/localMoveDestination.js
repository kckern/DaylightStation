import { hasNativePlaybackRenderer } from '@shared-contracts/media/playback-owner.mjs';
import { recoverySessionKey } from '../../../../../__capabilities/playback/browser/contracts.mjs';

const EVIDENCE_TIMEOUT_MS = 20_000;
const POSITION_TOLERANCE_SECONDS = 2;

function observeAdoption(local, snapshot, autoplay) {
  const { portability, recoveryIdentity } = local;
  const target = recoveryIdentity.getTarget();
  const visit = recoverySessionKey(target);
  const entry = snapshot.queue.items[snapshot.queue.currentIndex];
  const isCurrent = () => {
    const current = recoveryIdentity.getTarget();
    return recoverySessionKey(current) === visit && current?.intentRevision === target.intentRevision;
  };
  const readCandidate = () => {
    if (!isCurrent()) return null;
    const observation = portability.getNativeObservation();
    const identity = observation?.identity;
    if (!identity || identity.sessionId !== snapshot.sessionId || identity.queueItemId !== entry.queueItemId
      || identity.contentId !== entry.contentId || observation.readyState < 2
      || observation.seeking || observation.ended || observation.error || observation.paused !== !autoplay) return null;
    if (snapshot.currentItem.isLive !== true && Number.isFinite(snapshot.position)
      && (!Number.isFinite(observation.contentSeconds)
        || Math.abs(observation.contentSeconds - snapshot.position) > POSITION_TOLERANCE_SECONDS)) return null;
    return observation;
  };

  return new Promise(resolve => {
    const finish = (result) => {
      clearTimeout(deadline);
      unsubscribeNative();
      unsubscribeIdentity();
      resolve(result);
    };
    let previous = null;
    const check = () => {
      if (!isCurrent()) {
        finish({ status: 'uncertain', reason: 'destination-changed' });
        return;
      }
      const observation = readCandidate();
      // A renderer can start between mount and observation setup. A later
      // clock advance on the same bound node also proves playback.
      const advanced = observation && (observation.advancedObserved === true
        || (previous?.nodeGeneration === observation.nodeGeneration && observation.currentTime > previous?.currentTime));
      previous = observation;
      if (observation && (!autoplay || advanced)) {
        finish({ status: 'adopted', confirm: () => {
          const now = readCandidate();
          return now?.nodeGeneration === observation.nodeGeneration;
        } });
      }
    };
    const deadline = setTimeout(() => finish({ status: 'uncertain', reason: 'not-playing-here' }), EVIDENCE_TIMEOUT_MS);
    const unsubscribeNative = portability.subscribeNative(check);
    const unsubscribeIdentity = recoveryIdentity.subscribe(check);
    check();
  });
}

/** A local move preserves a paused source unless the caller explicitly plays it. */
export function createLocalMoveDestination({ localController, forcePlayback = false }) {
  return {
    async adopt({ snapshot }) {
      const controller = localController;
      const autoplay = forcePlayback || snapshot.state !== 'paused';
      const needsNative = forcePlayback || hasNativePlaybackRenderer(snapshot.currentItem?.format);
      const adopt = forcePlayback ? controller?.lifecycle?.adoptSnapshot : controller?.portability?.adopt;
      if (!adopt || (needsNative && (!controller.recoveryIdentity || !controller.portability?.subscribeNative))) {
        return { status: 'rejected', reason: 'no-local-session' };
      }
      const result = adopt(snapshot, { autoplay });
      if (result?.ok !== true) return { status: 'rejected', reason: result?.code ?? 'local-adopt-failed' };
      // Presentations such as a slideshow have a separate renderer contract.
      if (!needsNative) return { status: 'adopted' };
      return observeAdoption(controller, snapshot, autoplay);
    },
  };
}
