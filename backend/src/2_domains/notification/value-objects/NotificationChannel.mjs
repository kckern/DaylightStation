export const NotificationChannel = Object.freeze({
  TELEGRAM: 'telegram',
  EMAIL: 'email',
  PUSH: 'push',
  APP: 'app',
  values() { return ['telegram', 'email', 'push', 'app']; },
  isValid(v) { return this.values().includes(v); },
});
