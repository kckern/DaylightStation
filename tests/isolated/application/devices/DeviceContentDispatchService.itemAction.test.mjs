import { describe, it, expect, vi } from 'vitest';
import { DeviceContentDispatchService } from '../../../../backend/src/3_applications/devices/services/DeviceContentDispatchService.mjs';

describe('cold item-action cancellation', () => {
  function setup() {
    let options;
    const wake = { execute: vi.fn(async (_device, _query, opts) => { options = opts; return { ok: true }; }) };
    const service = new DeviceContentDispatchService({ wakeAndLoad: wake, logger: {}, configuration: {} });
    return { service, cancelled: () => options.isCancelled() };
  }
  it('cancels before receiver readiness and rejects late delivery', async () => {
    const { service, cancelled } = setup();
    await service.load('tv', { itemAction: JSON.stringify({ operationId: 'op', tappedAt: Date.now() }) });
    expect(service.cancelItemAction('tv', 'op')).toMatchObject({ ok: true, pending: true });
    expect(cancelled()).toBe(true);
    expect(service.claimItemAction('tv', 'op')).toMatchObject({ ok: false, code: 'ITEM_ACTION_CANCELLED' });
    expect(service.claimItemAction('other', 'op')).toMatchObject({ ok: true });
  });
  it('requires receiver Undo once the owner has claimed the operation', async () => {
    const { service } = setup();
    await service.load('tv', { itemAction: JSON.stringify({ operationId: 'op', tappedAt: Date.now() }) });
    expect(service.claimItemAction('tv', 'op')).toMatchObject({ ok: true });
    expect(service.cancelItemAction('tv', 'op')).toMatchObject({ ok: true, pending: false });
  });
});
