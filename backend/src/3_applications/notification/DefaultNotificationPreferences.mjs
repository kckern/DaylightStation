export const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
  ceremony: { normal: ['telegram', 'push', 'app'], high: ['telegram', 'push', 'app'] },
  drift_alert: { normal: ['telegram', 'app'] },
  goal_update: { normal: ['app'] },
  system: { normal: ['app'], high: ['telegram', 'app'] },
  school: { normal: ['telegram', 'app'], high: ['telegram', 'app'] },
});
