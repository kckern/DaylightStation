import {
  IconTarget, IconAlertTriangle, IconTrendingDown, IconBrain,
  IconCalendarEvent, IconSeeding,
} from '@tabler/icons-react';

// One source of truth for goal-state color. Superset of every state the API emits.
const GOAL_STATE_COLORS = {
  dream: 'grape', considered: 'blue', ready: 'cyan', committed: 'green',
  achieved: 'teal', failed: 'red', abandoned: 'dark', paused: 'yellow', evolved: 'violet',
};
export const goalStateColor = (state) => GOAL_STATE_COLORS[state] || 'gray';

export const beliefConfidenceColor = (confidence) => {
  if (confidence >= 0.8) return 'green';
  if (confidence >= 0.5) return 'yellow';
  return 'red';
};

const DRIFT_STATUS_COLORS = {
  aligned: 'green', drifting: 'yellow', reconsidering: 'red', insufficient_data: 'gray',
};
export const driftStatusColor = (status) => DRIFT_STATUS_COLORS[status] || 'gray';

// Priority-card metadata — includes the two new types added backend-side in Phase 3.
export const priorityTypeMeta = {
  goal_deadline:     { icon: IconTarget,          color: 'blue',   label: 'Goal' },
  drift_alert:       { icon: IconTrendingDown,    color: 'yellow', label: 'Drift' },
  anti_goal_warning: { icon: IconAlertTriangle,   color: 'red',    label: 'Warning' },
  dormant_belief:    { icon: IconBrain,           color: 'grape',  label: 'Belief' },
  ceremony_due:      { icon: IconCalendarEvent,   color: 'violet', label: 'Ritual' },
  plan_gap:          { icon: IconSeeding,         color: 'teal',   label: 'Setup' },
};
