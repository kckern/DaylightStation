import { describe, it, expect } from 'vitest';
import { RetroArchSessionLogReader } from './RetroArchSessionLogReader.mjs';

const LOG_DIR = '/storage/emulated/0/RetroArch/logs';
const A = 'retroarch__2026_09_11__19_30_55.log';
const B = 'retroarch__2026_09_11__19_36_41.log';

/** Fake ADB reproducing the device's real output shapes. */
function makeAdb({ names = [A, B], fail = false, missingContent = false } = {}) {
  const calls = [];
  return {
    calls,
    shell: async (cmd) => {
      calls.push(cmd);
      if (fail) return { ok: false, error: 'device offline' };
      if (cmd.includes('ls -1')) return { ok: true, output: names.join('\n') };
      if (cmd.includes('stat -c')) {
        return { ok: true, output: [
          `1789180276 ${A}`,
          `1789180604 ${B}`,
        ].join('\n') };
      }
      if (cmd.includes('Loading content file')) {
        if (missingContent) return { ok: true, output: '' };
        return { ok: true, output: [
          `${A}:[Content] Loading content file: "/storage/emulated/0/Games/GB/Super Mario Land (JUE) (V1.1) [!].gb".`,
          `${B}:[Content] Loading content file: "/storage/emulated/0/Games/SNES/Super Bomberman 2.sfc".`,
        ].join('\n') };
      }
      if (cmd.includes('Loading dynamic libretro core')) {
        return { ok: true, output:
          `${A}:[Core] Loading dynamic libretro core from: "/data/data/com.example/cores/gambatte_libretro_android.so".` };
      }
      return { ok: true, output: '' };
    },
  };
}

const reader = (adb) => new RetroArchSessionLogReader({ adbAdapter: adb, logDir: LOG_DIR, logger: { debug() {} } });

describe('RetroArchSessionLogReader', () => {
  it('recovers an exact start time from the filename', async () => {
    const [first] = await reader(makeAdb()).listRecentSessions();
    expect(first.startedAt).toBe('2026-09-11T19:30:55');
  });

  it('recovers WHICH game was played — the identity the command interface would have given', async () => {
    const sessions = await reader(makeAdb()).listRecentSessions();
    expect(sessions[0].contentPath).toBe('/storage/emulated/0/Games/GB/Super Mario Land (JUE) (V1.1) [!].gb');
    expect(sessions[1].contentPath).toBe('/storage/emulated/0/Games/SNES/Super Bomberman 2.sfc');
    expect(sessions[0].corePath).toMatch(/gambatte/);
  });

  it('returns lastWriteAt as a lower bound, never presented as an end', async () => {
    const [first] = await reader(makeAdb()).listRecentSessions();
    // Present and parseable, but the contract (and the header) call it a lower
    // bound — 59% of real sessions stop writing within a minute of starting.
    expect(first.lastWriteAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(first).not.toHaveProperty('endedAt');
  });

  it('returns sessions oldest first', async () => {
    const s = await reader(makeAdb({ names: [B, A] })).listRecentSessions();
    expect(s.map((x) => x.file)).toEqual([A, B]);
  });

  it('tolerates a log whose content line is missing', async () => {
    const s = await reader(makeAdb({ missingContent: true })).listRecentSessions();
    expect(s).toHaveLength(2);
    expect(s[0].contentPath).toBeNull();
  });

  it('ignores files that are not session logs', async () => {
    const s = await reader(makeAdb({ names: [A, 'notes.txt', 'retroarch.cfg'] })).listRecentSessions();
    expect(s.map((x) => x.file)).toEqual([A]);
  });

  it('returns nothing when the device cannot be reached, and does not throw', async () => {
    await expect(reader(makeAdb({ fail: true })).listRecentSessions()).resolves.toEqual([]);
  });

  it('reads the device in two round trips, not one per file', async () => {
    const adb = makeAdb();
    await reader(adb).listRecentSessions();
    expect(adb.calls).toHaveLength(4);       // list + stat + 2 greps
    expect(adb.calls.filter((c) => c.includes('grep'))).toHaveLength(2);
  });

  it('quotes the log directory so a path cannot break the shell command', async () => {
    const adb = makeAdb();
    const r = new RetroArchSessionLogReader({ adbAdapter: adb, logDir: "/tmp/a'b", logger: { debug() {} } });
    await r.listRecentSessions();
    expect(adb.calls[0]).toContain("'/tmp/a'\\''b'");
  });
});
