export const NotificationCategory = Object.freeze({
  CEREMONY: 'ceremony',
  DRIFT_ALERT: 'drift_alert',
  GOAL_UPDATE: 'goal_update',
  SCHOOL: 'school',
  SYSTEM: 'system',
  values() { return ['ceremony', 'drift_alert', 'goal_update', 'school', 'system']; },
  isValid(v) { return this.values().includes(v); },
});
