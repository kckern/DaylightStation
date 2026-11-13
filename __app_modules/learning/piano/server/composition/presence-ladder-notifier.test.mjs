import { describe, it, expect, vi } from 'vitest';
import { createPresenceLadderNotifier } from './presence-ladder-notifier.mjs';

const logger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() });
const call = { userId: 'learner_1', title: 'Right Hand C Position', minimalCheckIns: 4, at: '2026-11-13T23:05:00Z' };

function make({ enabled = true, svc = 'mobile_app_phone', gateway = { callService: vi.fn(async () => ({})) } } = {}) {
  const log = logger();
  const notify = createPresenceLadderNotifier({
    isEnabled: () => enabled,
    getHaGateway: () => gateway,
    getNotifyService: () => svc,
    getDisplayName: () => 'Kid One',
    timezone: 'America/Los_Angeles',
    logger: log,
  });
  return { notify, log, gateway };
}

describe('createPresenceLadderNotifier', () => {
  it('disabled: no push, logs why', async () => {
    const { notify, log, gateway } = make({ enabled: false });
    await notify(call);
    expect(gateway.callService).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith('piano.presence-ladder.notify-skipped', expect.objectContaining({ reason: 'disabled' }));
  });
  it('enabled with no notify service: no-target', async () => {
    const { notify, log, gateway } = make({ svc: null });
    await notify(call);
    expect(gateway.callService).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith('piano.presence-ladder.notify-skipped', expect.objectContaining({ reason: 'no-target' }));
  });
  it('enabled: one notify call with the composed push, tagged by the household day', async () => {
    const { notify, log, gateway } = make();
    await notify(call);
    expect(gateway.callService).toHaveBeenCalledTimes(1);
    const [domain, svc, payload] = gateway.callService.mock.calls[0];
    expect(domain).toBe('notify');
    expect(svc).toBe('mobile_app_phone');
    expect(payload.title).toBe('🎹 Kid One — Right Hand C Position');
    expect(payload.data.tag).toBe('piano-presence-learner_1-2026-11-13');
    expect(log.info).toHaveBeenCalledWith('piano.presence-ladder.notify-sent', expect.objectContaining({ userId: 'learner_1' }));
  });
  it('never throws when the gateway fails', async () => {
    const { notify, log } = make({ gateway: { callService: vi.fn(async () => { throw new Error('ha down'); }) } });
    await expect(notify(call)).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith('piano.presence-ladder.notify-failed', expect.objectContaining({ error: 'ha down' }));
  });
});
