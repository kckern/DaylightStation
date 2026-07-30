import { describe, it, expect, vi } from 'vitest';
import { HaApprovalNotifier } from '#adapters/home-automation/donow/HaApprovalNotifier.mjs';

const record = () => ({
  id: 'dnr_test1',
  surface: 'garage-fitness',
  label: 'Dance video in the garage',
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
    expect(payload.data.data.actions).toEqual([
      { action: 'DONOW_APPROVE_dnr_test1', title: 'Approve' },
      { action: 'DONOW_DENY_dnr_test1', title: 'Deny' },
    ]);
    expect(payload.data.message).toMatch(/Dance video in the garage/);
  });

  it('requires callHomeAssistant and notifyService', () => {
    expect(() => new HaApprovalNotifier({ notifyService: 'notify.x' })).toThrow();
    expect(() => new HaApprovalNotifier({ callHomeAssistant: { execute: vi.fn() } })).toThrow();
  });
});
