import { describe, expect, it, vi } from 'vitest';
import { NotifyApprovedScreen } from './NotifyApprovedScreen.mjs';

describe('NotifyApprovedScreen', () => {
  it('runs every configured script and isolates individual failures', async () => {
    const homeAutomation = { callService: vi.fn()
      .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined) };
    const logger = { info: vi.fn(), warn: vi.fn() };
    const operation = new NotifyApprovedScreen({
      scriptsForScreen: () => ['script.one', 'script.two'], homeAutomation, logger,
    });
    await operation.execute('living-room');
    expect(homeAutomation.callService).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith('trigger.ingress.barcode.display.failed',
      expect.objectContaining({ targetScreen: 'living-room', scriptId: 'script.one' }));
  });
});
