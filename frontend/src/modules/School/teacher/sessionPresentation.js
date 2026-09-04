const DONE_STATES = new Set([
  'graded', 'outcome_recorded', 'rewarded', 'media_completed', 'external_activity_assessed',
]);
const IN_FLIGHT_STATES = new Set([
  'issued', 'reprinted', 'media_dispatched', 'media_stalled', 'launch_dispatched',
  'program_dispatched', 'external_activity_dispatched', 'submitted',
]);

export const SESSION_PROGRESS_STATES = { DONE_STATES, IN_FLIGHT_STATES };

/** One source for the teacher-facing words attached to lifecycle state. */
export function presentSessionState(sessionState = {}) {
  const state = sessionState?.state ?? sessionState?.status ?? null;
  const outcome = sessionState?.outcome?.result ?? sessionState?.result ?? null;

  // Once the retry is actually open, that state is more specific than the
  // parent outcome that caused it and must win the wording.
  if (state === 'remediation_opened') return {
    label: 'Another try assigned', tone: 'active', dayStatus: 'in-progress', complete: false,
    description: 'A follow-up attempt is ready for the learner.',
  };
  if (outcome === 'needs_remediation') return {
    label: 'Needs another try', tone: 'attention', dayStatus: 'done', complete: false,
    description: 'The work was marked and another attempt is recommended.',
  };
  if (outcome === 'passed' || ['rewarded', 'closed', 'completed'].includes(state)) return {
    label: 'Completed', tone: 'success', dayStatus: 'done', complete: true,
    description: 'The lesson is complete.',
  };
  if (state === 'created') return {
    label: 'Not started', tone: 'neutral', dayStatus: 'planned', complete: false,
    description: 'The agenda entry exists, but nothing has been launched or printed.',
  };
  if (['issued', 'reprinted'].includes(state)) return {
    label: 'In progress', tone: 'active', dayStatus: 'in-progress', complete: false,
    description: 'A worksheet was issued; the work has not come back yet.',
  };
  if (state === 'media_stalled') return {
    label: 'Needs attention', tone: 'attention', dayStatus: 'in-progress', complete: false,
    description: 'Playback stopped before the activity finished.',
  };
  if (['media_dispatched', 'launch_dispatched', 'program_dispatched', 'external_activity_dispatched'].includes(state)) return {
    label: 'In progress', tone: 'active', dayStatus: 'in-progress', complete: false,
    description: 'The activity started and is waiting for completion.',
  };
  if (state === 'submitted') return {
    label: 'Awaiting review', tone: 'attention', dayStatus: 'in-progress', complete: false,
    description: 'The work came back and is waiting to be marked.',
  };
  if (state === 'graded') return {
    label: 'Graded', tone: 'success', dayStatus: 'done', complete: false,
    description: 'The work was marked; final lesson processing may still be pending.',
  };
  if (['media_completed', 'external_activity_assessed', 'outcome_recorded'].includes(state)) return {
    label: 'Activity completed', tone: 'success', dayStatus: 'done', complete: false,
    description: 'The activity finished; final lesson processing may still be pending.',
  };
  if (state === 'abandoned') return {
    label: 'Closed without completion', tone: 'neutral', dayStatus: 'planned', complete: false,
    description: 'This session was closed without recording completed work.',
  };
  return {
    label: 'Status unavailable', tone: 'neutral', dayStatus: 'planned', complete: false,
    description: 'The lesson record does not include a recognized status.',
  };
}

export default presentSessionState;
