import { describe, expect, it, vi } from 'vitest';
import { NotifyReadingSessionFailure } from './NotifyReadingSessionFailure.mjs';

describe('NotifyReadingSessionFailure', () => {
  it('sends the established adult alert through the notification port', async () => {
    const notifier = { callService: vi.fn(async () => undefined) };
    const operation = new NotifyReadingSessionFailure({
      notificationTargetForDevice: () => 'mobile_app_parent', notifier,
    });
    await operation.execute({ target: 'tv', location: 'den', learnerId: 'Ada' });
    expect(notifier.callService).toHaveBeenCalledWith('notify', 'mobile_app_parent', {
      title: 'Story time screen needs help',
      message: 'Ada started story time at den, but the screen did not respond.',
    });
  });
});
