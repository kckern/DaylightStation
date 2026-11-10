import { useEffect, useRef, useState, useReducer } from 'react';
import { resolveContentId } from '../../../../../__capabilities/playback/browser/contracts.mjs';
import { DaylightAPI } from '../../../../../frontend/src/lib/api.mjs';
import getLogger from '../../../../../frontend/src/lib/logging/Logger.js';
import { classifySupervision, isGovernedChildId } from '../../shared/supervision.mjs';
import { PlaybackBudgetController } from './PlaybackBudgetController.js';

const INACTIVE = { blocked: false, status: 'inactive', remainingMs: 0 };
/** Provider-owned observer survives Player closing, so roster joins still reset. */
export function usePlaybackBudget({ deviceId, policies, supervisorIds, exemptIds, participantRoster, currentMedia, governanceState, mediaRef, externalHold }) {
  const [state, setState] = useState(INACTIVE);
  const controller = useRef(null);
  const resumeTask = useRef(null);
  const [resumeVersion, acknowledgeResume] = useReducer(n => n + 1, 0);
  useEffect(() => { const work = resumeTask.current; resumeTask.current = null; work?.(); }, [resumeVersion]);
  const enabled = policies != null && (!Array.isArray(policies) || policies.length > 0);
  const latest = useRef(null);
  const active = (participantRoster ?? []).filter(p => p.isActive !== false && p.id);
  const participantIds = active.map(p => p.id);
  // Guest assignments are sent to the server too, so both sides apply the same
  // rule: a guest-picked supervisor does not supervise, a guest is never metered.
  const guestIds = active.filter(p => p.isGuest).map(p => p.id);
  const { supervised } = classifySupervision({ participantIds, supervisorIds, guestIds });
  // No governed child (only supervisors, guests or exempt riders): nothing to meter.
  const hasSubject = participantIds.some(id => isGovernedChildId(id, { supervisorIds, exemptIds, guestIds }));
  latest.current = {
    participantIds, guestIds, supervised, hasSubject, contentId: currentMedia ? resolveContentId(currentMedia) : null,
    matching: Boolean(currentMedia && governanceState?.isGoverned),
    canPlay: !governanceState?.videoLocked && !externalHold,
  };
  useEffect(() => {
    if (!enabled) { setState(INACTIVE); return undefined; }
    if (!deviceId) { setState({ blocked: true, status: 'unavailable', remainingMs: 0 }); return undefined; }
    const meter = new PlaybackBudgetController({
      deviceId, streamId: crypto.randomUUID(), now: () => performance.now(),
      observe: body => DaylightAPI('/api/v1/fitness/playback-budgets/observe', body, 'POST'),
      publish: next => setState(previous => {
        const rounded = { ...next, remainingMs: Math.ceil(next.remainingMs / 1000) * 1000 };
        return JSON.stringify(previous) === JSON.stringify(rounded) ? previous : rounded;
      }),
      logger: getLogger(),
      // Resume only after React committed the opened gate; progress callbacks
      // otherwise still see the old blocking verdict.
      queueResume: work => { resumeTask.current = work; acknowledgeResume(); },
    });
    controller.current = meter;
    const update = () => {
      const handle = mediaRef.current;
      const media = handle?.getMediaElement?.() ?? (handle?.tagName ? handle : null);
      meter.update({ ...latest.current, media });
      meter.tick();
    };
    update();
    const timer = setInterval(update, 50);
    return () => { clearInterval(timer); controller.current = null; void meter.dispose(); };
  }, [enabled, deviceId, mediaRef]);
  return enabled ? state : INACTIVE;
}
