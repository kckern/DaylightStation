/** Notifies an adult when a reading screen never acknowledges its session. */
export class NotifyReadingSessionFailure {
  constructor({ notificationTargetForDevice, notifier } = {}) {
    if (typeof notificationTargetForDevice !== 'function') {
      throw new Error('NotifyReadingSessionFailure requires notificationTargetForDevice');
    }
    this.notificationTargetForDevice = notificationTargetForDevice;
    this.notifier = notifier;
  }

  async execute({ target, location, learnerId }) {
    const notificationTarget = target ? this.notificationTargetForDevice(target) : null;
    if (!notificationTarget || !this.notifier?.callService) return;
    await this.notifier.callService('notify', notificationTarget, {
      title: 'Story time screen needs help',
      message: `${learnerId ?? 'A learner'} started story time at ${location}, but the screen did not respond.`,
    });
  }
}

export default NotifyReadingSessionFailure;
