import { validateParticipantLaunchRef } from '../../../../__capabilities/content-catalog/portable/participant-launch.mjs';
import {getLogger} from '../../lib/logging/Logger.js';

const actions = new Set(['open', 'play', 'queue', 'display']);

/** Intercept only a reference attached to the selected action. Invalid refs fail closed. */
export function dispatchParticipantAction({ selection, action, onOrdinaryAction, onPresentation, onInvalid }) {
  if (selection?.disabled) return;
  const refs = selection?.participantLaunches;
  const invalid=()=>{
    const code='invalid_participant_launch';
    getLogger().warn('participant-launch.invalid-reference',{code,action:actions.has(action) ? action : 'unknown'});
    return onInvalid?.({code});
  };
  if (Object.hasOwn(selection || {}, 'participantLaunches') && (!refs || typeof refs !== 'object' || Array.isArray(refs))) return invalid();
  if (!actions.has(action) || !refs || !Object.hasOwn(refs, action)) {
    return onOrdinaryAction?.(selection);
  }
  let ref;
  try { ref = validateParticipantLaunchRef(refs[action]); }
  catch { return invalid(); }
  return onPresentation?.({ ref, action });
}
