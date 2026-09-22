/**
 * Notifies an adult when a reading screen never acknowledges its session.
 *
 * The one implementation of the story-time failure push: composition routes
 * the reading-session handler's `alertAdult` here. The copy follows the push
 * standard (docs/reference/notifications/push-standard.md): the child and the
 * screen by name, ids only in the tag, and a repeat for the same screen
 * replaces its card without ringing again.
 */
import { pushData, titleCaseId } from '#domains/notification/push/pushText.mjs';

export class NotifyReadingSessionFailure {
  /**
   * @param {Object} deps
   * @param {(deviceId: string) => string|null} deps.notificationTargetForDevice - HA notify service for a device
   * @param {{ callService: Function }|null} deps.notifier - HA gateway; absent, nothing is sent
   * @param {(learnerId: string) => (string|null|Promise<string|null>)} [deps.studentName] - the child's display name
   * @param {(deviceId: string) => string|null} [deps.deviceLabel] - the screen's display name ("Living Room TV")
   */
  constructor({ notificationTargetForDevice, notifier, studentName = null, deviceLabel = null } = {}) {
    if (typeof notificationTargetForDevice !== 'function') {
      throw new Error('NotifyReadingSessionFailure requires notificationTargetForDevice');
    }
    this.notificationTargetForDevice = notificationTargetForDevice;
    this.notifier = notifier;
    this.studentName = typeof studentName === 'function' ? studentName : null;
    this.deviceLabel = typeof deviceLabel === 'function' ? deviceLabel : null;
  }

  async execute({ target, location, learnerId }) {
    const notificationTarget = target ? this.notificationTargetForDevice(target) : null;
    if (!notificationTarget || !this.notifier?.callService) return;
    // A label lookup that fails, synchronously or not, must not cost the
    // adult the alert: each falls back to the plain copy.
    const child = learnerId
      ? ((await Promise.resolve().then(() => this.studentName?.(learnerId)).catch(() => null)) ?? titleCaseId(learnerId))
      : null;
    const screen = target
      ? await Promise.resolve().then(() => this.deviceLabel?.(target)).catch(() => null)
      : null;
    await this.notifier.callService('notify', notificationTarget, {
      title: child ? `📖 ${child}'s story time didn't start` : "📖 Story time didn't start",
      message: `The ${screen || 'screen'} didn't respond`,
      data: pushData({ tag: `story-${target ?? location ?? 'screen'}`, alertOnce: true }),
    });
  }
}

export default NotifyReadingSessionFailure;
