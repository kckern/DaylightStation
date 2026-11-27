import { describe, it, expect, vi } from 'vitest';
import { AdbAdapter } from './AdbAdapter.mjs';

function fixture(execCommand) {
  const logger = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  };
  const adapter = new AdbAdapter({ host: '10.20.30.12' }, { logger, execCommand });
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
      expect.objectContaining({ serial: '10.20.30.12:5555' }),
    );
  });

  it('shellArgv passes the script as one argv element, with no host shell', async () => {
    const execFileCommand = vi.fn().mockResolvedValueOnce({ stdout: 'x\n', stderr: '' });
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const adapter = new AdbAdapter({ host: '10.20.30.12' }, { logger, execFileCommand });
    const script = "cat '/c/Mega Man'\\''s $HOME.cfg'";

    await expect(adapter.shellArgv(script)).resolves.toMatchObject({ ok: true, output: 'x' });
    expect(execFileCommand).toHaveBeenCalledWith('adb', ['-s', '10.20.30.12:5555', 'shell', script], expect.any(Object));
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

describe('AdbAdapter while a device is away', () => {
  const away = () => Object.assign(new Error("Command failed: adb -s 10.20.30.12:5555 shell echo ok\nadb: device '10.20.30.12:5555' not found\n"), { code: 1 });

  it('logs one error, hourly warnings, and one info when the device answers again', async () => {
    let now = 0;
    const execCommand = vi.fn(async (cmd) => {
      if (cmd.startsWith('adb connect')) return { stdout: 'failed to connect', stderr: '' };
      if (execCommand.back) return { stdout: 'ok', stderr: '' };
      throw away();
    });
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const adapter = new AdbAdapter({ host: '10.20.30.12' }, { logger, execCommand, now: () => now });

    for (let i = 0; i < 300; i++) { now = i * 16_000; await adapter.shell('pidof x'); } // 80 min of polls
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls.filter(([e]) => e === 'adb.connect.verifyFailed')).toHaveLength(1);
    expect(logger.warn.mock.calls.filter(([e]) => e === 'adb.device.stillUnreachable')).toHaveLength(1);

    execCommand.back = true;
    now += 16_000;
    await expect(adapter.shell('pidof x')).resolves.toMatchObject({ ok: true });
    expect(logger.info).toHaveBeenCalledWith('adb.device.reachable', expect.objectContaining({ serial: '10.20.30.12:5555' }));

    execCommand.back = false;
    await adapter.shell('pidof x');
    expect(logger.error).toHaveBeenCalledTimes(2); // a new absence is news again
  });
});
