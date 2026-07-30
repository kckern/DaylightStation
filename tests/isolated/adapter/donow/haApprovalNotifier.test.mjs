import { describe, it, expect, vi } from 'vitest';
import { HaApprovalNotifier } from '#adapters/home-automation/donow/HaApprovalNotifier.mjs';

// Article-free, lowercase — the real shape a surface adapter's `label()` now
// returns (spec review finding). `HaApprovalNotifier` is the one place a
// label starts a sentence, so it must capitalize it itself.
const record = () => ({
  id: 'dnr_test1',
  surface: 'garage-fitness',
  label: 'dance video in the garage',
});

describe('HaApprovalNotifier.notify', () => {
  it('splits notifyService at the dot and sends an actionable notification with both action ids', async () => {
    const callHomeAssistant = { execute: vi.fn().mockResolvedValue({ result: 'ok' }) };
    const notifier = new HaApprovalNotifier({
      callHomeAssistant,
      notifyService: 'notify.mobile_app_parent_phones',
    });

    await notifier.notify(record());

    expect(callHomeAssistant.execute).toHaveBeenCalledTimes(1);
    const [payload] = callHomeAssistant.execute.mock.calls[0];
    expect(payload.domain).toBe('notify');
    expect(payload.service).toBe('mobile_app_parent_phones');
    expect(payload.data.data).toMatchObject({ ttl: 0, priority: 'high' }); // immediate FCM delivery — doze must not outlive the approval TTL
    expect(payload.data.data.actions).toEqual([
      { action: 'DONOW_APPROVE_dnr_test1', title: 'Approve' },
      { action: 'DONOW_DENY_dnr_test1', title: 'Deny' },
    ]);
    // Capitalized at sentence start even though the label itself is lowercase.
    expect(payload.data.message).toMatch(/^Dance video in the garage/);
  });

  it('capitalizes an article-free label at the start of the message', async () => {
    const callHomeAssistant = { execute: vi.fn().mockResolvedValue({ result: 'ok' }) };
    const notifier = new HaApprovalNotifier({
      callHomeAssistant,
      notifyService: 'notify.mobile_app_parent_phones',
    });

    await notifier.notify({ ...record(), label: 'garage fitness kiosk' });

    const [payload] = callHomeAssistant.execute.mock.calls[0];
    expect(payload.data.message).toBe("Garage fitness kiosk — a grown-up's OK is needed to start.");
  });

  it('requires callHomeAssistant and notifyService', () => {
    expect(() => new HaApprovalNotifier({ notifyService: 'notify.x' })).toThrow();
    expect(() => new HaApprovalNotifier({ callHomeAssistant: { execute: vi.fn() } })).toThrow();
  });
});
