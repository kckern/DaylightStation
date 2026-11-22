import { describe, it, expect, vi } from 'vitest';
import { ArcadeGameAlert } from './ArcadeGameAlert.mjs';

const logger = () => ({ info: vi.fn(), warn: vi.fn() });

describe('ArcadeGameAlert', () => {
  it('pushes through the injected sender to the device HA target', async () => {
    const sendPush = vi.fn().mockResolvedValue({ ok: true, results: [{ delivered: true }] });
    const alert = new ArcadeGameAlert({ sendPush, serviceByDevice: new Map([['garage-tv', 'mobile_app_owner_phone']]), logger: logger() });
    expect(await alert.raise({ deviceId: 'garage-tv', condition: 'blind', message: 'The garage arcade stopped reporting' })).toBe(true);
    expect(sendPush).toHaveBeenCalledWith({ title: 'Arcade', message: 'The garage arcade stopped reporting', haNotifyService: 'mobile_app_owner_phone' });
  });
  it('is undeliverable without a device target', async () => {
    const sendPush = vi.fn(), log = logger();
    expect(await new ArcadeGameAlert({ sendPush, serviceByDevice: new Map(), logger: log }).raise({ deviceId: 'x', condition: 'c', message: 'm' })).toBe(false);
    expect(sendPush).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith('arcade.alert.undeliverable', expect.any(Object));
  });
  it('a failing sender is swallowed and reported false', async () => {
    const sendPush = vi.fn().mockRejectedValue(new Error('down'));
    expect(await new ArcadeGameAlert({ sendPush, serviceByDevice: new Map([['d', 's']]), logger: logger() }).raise({ deviceId: 'd', condition: 'c', message: 'm' })).toBe(false);
  });
  it('a push no transport delivered is false', async () => {
    const sendPush = vi.fn().mockResolvedValue({ ok: false, results: [{ delivered: false }] });
    expect(await new ArcadeGameAlert({ sendPush, serviceByDevice: new Map([['d', 's']]), logger: logger() }).raise({ deviceId: 'd', condition: 'c', message: 'm' })).toBe(false);
  });
});
