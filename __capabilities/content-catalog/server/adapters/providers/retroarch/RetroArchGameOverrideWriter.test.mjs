import { describe, it, expect, vi } from 'vitest';
import { RetroArchGameOverrideWriter } from './RetroArchGameOverrideWriter.mjs';

const plan = { consoleId: 'snes', gameId: 'mms', path: "/c/Snes9x/Mega Man's Soccer.cfg", resume: false };
const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function decodeWrite(script) {
  const b64 = script.match(/echo (\S+) \| base64 -d/)[1];
  return Buffer.from(b64, 'base64').toString('utf8');
}

describe('RetroArchGameOverrideWriter', () => {
  it('writes a missing file, quoting the path for the device shell', async () => {
    const shell = vi.fn()
      .mockResolvedValueOnce({ ok: true, output: '' })
      .mockResolvedValueOnce({ ok: true, output: '' });
    const res = await new RetroArchGameOverrideWriter({ shell, logger }).ensure(plan);
    expect(res).toEqual({ status: 'written', path: plan.path });
    expect(shell.mock.calls[0][0]).toBe("cat '/c/Snes9x/Mega Man'\\''s Soccer.cfg' 2>/dev/null; true");
    const write = shell.mock.calls[1][0];
    expect(write.startsWith("mkdir -p '/c/Snes9x' && echo ")).toBe(true);
    expect(write.endsWith("> '/c/Snes9x/Mega Man'\\''s Soccer.cfg'")).toBe(true);
    expect(decodeWrite(write)).toBe('savestate_auto_load = "false"\n');
  });

  it('does not write when the value already matches (adb trims stdout)', async () => {
    const shell = vi.fn().mockResolvedValueOnce({ ok: true, output: 'savestate_auto_load = "false"' });
    const res = await new RetroArchGameOverrideWriter({ shell, logger }).ensure(plan);
    expect(res.status).toBe('unchanged');
    expect(shell).toHaveBeenCalledTimes(1);
  });

  it('preserves other keys when flipping', async () => {
    const shell = vi.fn()
      .mockResolvedValueOnce({ ok: true, output: 'input_x = "1"\nsavestate_auto_load = "true"' })
      .mockResolvedValueOnce({ ok: true, output: '' });
    await new RetroArchGameOverrideWriter({ shell, logger }).ensure(plan);
    expect(decodeWrite(shell.mock.calls[1][0])).toBe('input_x = "1"\nsavestate_auto_load = "false"\n');
  });

  it('reports failure without throwing', async () => {
    const shell = vi.fn().mockResolvedValueOnce({ ok: false, error: 'device offline' });
    const res = await new RetroArchGameOverrideWriter({ shell, logger }).ensure(plan);
    expect(res).toEqual({ status: 'failed', path: plan.path, error: 'read: device offline' });
  });
});
