import { validateParticipantLaunchRef } from '../../../../__capabilities/content-catalog/portable/participant-launch.mjs';

const actions = new Set(['open', 'play', 'queue', 'display']);

/** Intercept only a reference attached to the selected action. Invalid refs fail closed. */
export function dispatchParticipantAction({ selection, action, onOrdinaryAction, onPresentation }) {
  if (selection?.disabled) return;
  const refs = selection?.participantLaunches;
  if (Object.hasOwn(selection || {}, 'participantLaunches') && (!refs || typeof refs !== 'object' || Array.isArray(refs))) return;
  if (!actions.has(action) || !refs || !Object.hasOwn(refs, action)) {
    return onOrdinaryAction?.(selection);
  }
  try {
    const ref = validateParticipantLaunchRef(refs[action]);
    return onPresentation?.({ ref, action });
  } catch {
    return undefined;
  }
}
