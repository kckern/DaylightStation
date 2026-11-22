export const NotificationCategory = Object.freeze({
  CEREMONY: 'ceremony',
  DRIFT_ALERT: 'drift_alert',
  GOAL_UPDATE: 'goal_update',
  SCHOOL: 'school',
  SYSTEM: 'system',
  APPROVAL: 'approval',
  HOUSEHOLD_ALERT: 'household_alert',
  values() { return ['ceremony', 'drift_alert', 'goal_update', 'school', 'system', 'approval', 'household_alert']; },
  isValid(v) { return this.values().includes(v); },
});
