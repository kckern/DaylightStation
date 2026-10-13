export const NotificationUrgency = Object.freeze({
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  CRITICAL: 'critical',
  values() { return ['low', 'normal', 'high', 'critical']; },
  isValid(v) { return this.values().includes(v); },
});
