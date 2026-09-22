import { describe, expect, it, vi } from 'vitest';
import { NotifyReadingSessionFailure } from './NotifyReadingSessionFailure.mjs';
import { findPushTextDefects } from '#domains/notification/push/pushText.mjs';

const make = (overrides = {}) => {
  const notifier = { callService: vi.fn(async () => undefined) };
  const operation = new NotifyReadingSessionFailure({
    notificationTargetForDevice: () => 'mobile_app_parent',
    notifier,
    studentName: async (id) => (id === 'user_4' ? 'Learner4' : null),
    deviceLabel: (id) => (id === 'livingroom-tv' ? 'Living Room TV' : null),
    ...overrides,
  });
  return { notifier, operation };
};

describe('NotifyReadingSessionFailure', () => {
  it('names the child and the screen, and tags the card by screen', async () => {
    const { notifier, operation } = make();
    await operation.execute({ target: 'livingroom-tv', location: 'livingroom', learnerId: 'user_4' });
    expect(notifier.callService).toHaveBeenCalledTimes(1);
    const [domain, service, payload] = notifier.callService.mock.calls[0];
    expect(domain).toBe('notify');
    expect(service).toBe('mobile_app_parent');
    expect(payload.title).toBe("📖 Learner4's story time didn't start");
    expect(payload.message).toBe("The Living Room TV didn't respond");
    expect(payload.data).toEqual({ tag: 'story-livingroom-tv', alert_once: true });
    expect(findPushTextDefects(payload.title)).toEqual([]);
    expect(findPushTextDefects(payload.message)).toEqual([]);
  });

  it('falls back to a title-cased id and a generic screen, never the raw id', async () => {
    const { notifier, operation } = make({ studentName: undefined, deviceLabel: undefined });
    await operation.execute({ target: 'livingroom-tv', location: 'livingroom', learnerId: 'user_4' });
    const [, , payload] = notifier.callService.mock.calls[0];
    expect(payload.title).toBe("📖 User 4's story time didn't start");
    expect(payload.message).toBe("The screen didn't respond");
    expect(findPushTextDefects(payload.title)).toEqual([]);
    expect(findPushTextDefects(payload.message)).toEqual([]);
  });

  it('reads without a learner', async () => {
    const { notifier, operation } = make();
    await operation.execute({ target: 'livingroom-tv', location: 'livingroom', learnerId: null });
    const [, , payload] = notifier.callService.mock.calls[0];
    expect(payload.title).toBe("📖 Story time didn't start");
    expect(findPushTextDefects(payload.title)).toEqual([]);
  });

  it('sends nothing without a gateway or a notify target', async () => {
    const noGateway = new NotifyReadingSessionFailure({ notificationTargetForDevice: () => 'mobile_app_parent', notifier: null });
    await expect(noGateway.execute({ target: 'livingroom-tv', location: 'livingroom', learnerId: 'user_4' })).resolves.toBeUndefined();
    const { notifier, operation } = make({ notificationTargetForDevice: () => null });
    await operation.execute({ target: 'livingroom-tv', location: 'livingroom', learnerId: 'user_4' });
    expect(notifier.callService).not.toHaveBeenCalled();
  });
});
