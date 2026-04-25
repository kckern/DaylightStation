import { describe, it, expect, vi } from 'vitest';
import { actionHandlers, dispatchAction, UnknownActionError } from '#apps/trigger/actionHandlers.mjs';

describe('actionHandlers.clear', () => {
  it('calls deviceService.get(target).clearContent()', async () => {
    const clearContent = vi.fn().mockResolvedValue({ ok: true });
    const deviceService = { get: vi.fn().mockReturnValue({ clearContent }) };

    const result = await actionHandlers.clear(
      { action: 'clear', target: 'livingroom-tv' },
      { deviceService },
    );

    expect(deviceService.get).toHaveBeenCalledWith('livingroom-tv');
    expect(clearContent).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });

  it('throws when target device is missing', async () => {
    const deviceService = { get: vi.fn().mockReturnValue(null) };
    await expect(
      actionHandlers.clear({ action: 'clear', target: 'ghost' }, { deviceService })
    ).rejects.toThrow(/Unknown target device/);
  });
});

describe('dispatchAction', () => {
  it('throws UnknownActionError for an unregistered action', async () => {
    await expect(dispatchAction({ action: 'levitate' }, {})).rejects.toThrow(UnknownActionError);
  });
});
