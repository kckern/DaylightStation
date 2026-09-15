import { describe, it, expect, vi } from 'vitest';
import { AdbAdapter } from './AdbAdapter.mjs';

function fixture(execCommand) {
  const logger = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  };
  const adapter = new AdbAdapter({ host: '10.0.0.12' }, { logger, execCommand });
  return { adapter, logger };
}

describe('AdbAdapter shell recovery', () => {
  it('treats a cold-daemon miss as a recoverable transition, not an error', async () => {
    const execCommand = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('device not found'), { code: 1 }))
      .mockResolvedValueOnce({ stdout: 'connected', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'ok', stderr: '' })
      .mockResolvedValueOnce({ stdout: '321', stderr: '' });
    const { adapter, logger } = fixture(execCommand);

    await expect(adapter.shell('pidof com.retroarch.aarch64')).resolves.toMatchObject({
      ok: true, output: '321',
    });
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      'adb.shell.recovered',
      expect.objectContaining({ serial: '10.0.0.12:5555' }),
    );
  });

  it('still records a genuine shell failure as an error', async () => {
    const execCommand = vi.fn().mockRejectedValueOnce(new Error('permission denied'));
    const { adapter, logger } = fixture(execCommand);

    await expect(adapter.shell('cat /protected')).resolves.toMatchObject({ ok: false });
    expect(logger.error).toHaveBeenCalledWith(
      'adb.exec.error',
      expect.objectContaining({ error: 'permission denied' }),
    );
  });
});
