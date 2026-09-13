import { describe, it, expect, beforeEach } from 'vitest';
import { RetroArchPlayObservationSource } from './RetroArchPlayObservationSource.mjs';
import { PlayState } from '#domains/gaming/value-objects/PlayState.mjs';

const PKG = 'com.example.emulator';
const KIOSK_PKG = 'com.example.kiosk';
const CONTENT = { contentId: 'game:a', title: 'Game A' };
const DEVICE = 'livingroom-tv';

function makeKiosk(foregroundApp) {
  return { command: async () => (foregroundApp === undefined
    ? { ok: false }
    : { ok: true, data: { foregroundApp } }) };
}

/** ADB fake: `ticks` is a queue of utime+stime totals, one per poll. */
function makeAdb({ pid = '1234', ticks = [], available = true, focusedApp = null } = {}) {
  let i = 0;
  return {
    shell: async (cmd) => {
      if (!available) return { ok: false };
      if (cmd.startsWith('dumpsys window')) {
        return { ok: true, output: focusedApp ? `mFocusedApp=ActivityRecord{abc u0 ${focusedApp}/.MainActivity t42}` : 'mCurrentFocus=null' };
      }
      if (cmd.startsWith('pidof')) return { ok: true, output: pid === null ? '' : String(pid) };
      const total = ticks[Math.min(i++, ticks.length - 1)] ?? 0;
      // fields 14/15 are utime/stime — pad the leading 13 fields.
      return { ok: true, output: `${pid} (emu) S ${Array(11).fill(0).join(' ')} ${total} 0 0 0` };
    },
  };
}

const source = (kiosk, adb, extra = {}) => new RetroArchPlayObservationSource({
  kioskClient: kiosk, adbAdapter: adb, packageName: PKG,
  pollIntervalMs: 10_000, missesBeforeGone: 2, logger: { debug() {}, warn() {} }, ...extra,
});

const observe = (s) => s.observe(DEVICE, { expectedContent: CONTENT });

describe('observation source — cannot see', () => {
  it('reports unknown when the kiosk cannot be reached', async () => {
    const r = await observe(source(makeKiosk(undefined), makeAdb({ available: false })));
    expect(r.state).toBe(PlayState.UNKNOWN);
    expect(r.content).toBeNull();
    expect(r.loaded).toBeNull();
    expect(r.channel).toBe('none');
  });

  it('states its accuracy bound', async () => {
    const s = source(makeKiosk(PKG), makeAdb());
    expect(s.confidenceMs).toBe(10_000);
    expect((await observe(s)).confidenceMs).toBe(10_000);
  });
});

describe('observation source — ADB-only fallback when kiosk REST is down', () => {
  it('still confirms play from focused window plus a rising CPU delta', async () => {
    const s = source(makeKiosk(undefined), makeAdb({ focusedApp: PKG, ticks: [100, 250] }));
    expect(await observe(s)).toMatchObject({ state: PlayState.UNKNOWN, loaded: true, channel: 'adb' });
    expect(await observe(s)).toMatchObject({ state: PlayState.PLAYING, loaded: true, channel: 'adb', cpuDelta: 150 });
  });

  it('debounces an ADB-confirmed focused-app departure before ending', async () => {
    const s = source(makeKiosk(undefined), makeAdb({ focusedApp: KIOSK_PKG }));
    expect(await observe(s)).toMatchObject({ state: PlayState.UNKNOWN, loaded: null, channel: 'adb' });
    expect(await observe(s)).toMatchObject({ state: PlayState.PAUSED, loaded: false, channel: 'adb' });
  });

  it('does not claim play when neither presence channel can answer', async () => {
    const r = await observe(source(makeKiosk(undefined), makeAdb({ available: false })));
    expect(r).toMatchObject({ state: PlayState.UNKNOWN, loaded: null, channel: 'none' });
  });
});

describe('observation source — debounce on leaving the foreground', () => {
  it('a single miss is unknown, not an ending', async () => {
    const r = await observe(source(makeKiosk(KIOSK_PKG), makeAdb()));
    expect(r.state).toBe(PlayState.UNKNOWN);
    expect(r.content).toBeNull();
    expect(r.loaded).toBeNull();
  });

  it('a sustained absence reports nothing loaded', async () => {
    const s = source(makeKiosk(KIOSK_PKG), makeAdb());
    await observe(s);
    const second = await observe(s);
    expect(second.state).toBe(PlayState.PAUSED);
    expect(second.content).toBeNull();
    expect(second.loaded).toBe(false);
  });

  it('the miss counter resets when the game comes back', async () => {
    let fg = KIOSK_PKG;
    const kiosk = { command: async () => ({ ok: true, data: { foregroundApp: fg } }) };
    const s = source(kiosk, makeAdb({ ticks: [100, 250] }));
    await observe(s);            // miss 1
    fg = PKG;
    await observe(s);            // back — resets
    fg = KIOSK_PKG;
    const r = await observe(s);  // miss 1 again, not 2
    expect(r.state).toBe(PlayState.UNKNOWN);
  });
});

describe('observation source — foreground alone is not proof of play', () => {
  it('first sample yields unknown because there is no delta yet', async () => {
    const r = await observe(source(makeKiosk(PKG), makeAdb({ ticks: [100] })));
    expect(r.state).toBe(PlayState.UNKNOWN);
    expect(r.content).toEqual(CONTENT);
    expect(r.loaded).toBe(true);
  });

  it('a rising CPU delta is play', async () => {
    const s = source(makeKiosk(PKG), makeAdb({ ticks: [100, 250] }));
    await observe(s);
    const r = await observe(s);
    expect(r.state).toBe(PlayState.PLAYING);
    expect(r.cpuDelta).toBe(150);
  });

  it('foregrounded but burning no CPU is NOT play', async () => {
    // The real failure this guards: a foregrounded emulator with a core that
    // never loaded. Billing it would charge for a game that never started.
    const s = source(makeKiosk(PKG), makeAdb({ ticks: [100, 100] }));
    await observe(s);
    const r = await observe(s);
    expect(r.state).toBe(PlayState.PAUSED);
    expect(r.loaded).toBe(true);
  });

  it('a restarted process does not accrue across its own restart', async () => {
    let pid = '111';
    const adb = {
      shell: async (cmd) => cmd.startsWith('pidof')
        ? { ok: true, output: pid }
        : { ok: true, output: `${pid} (emu) S ${Array(11).fill(0).join(' ')} 500 0 0 0` },
    };
    const s = source(makeKiosk(PKG), adb);
    await observe(s);
    pid = '222';
    const r = await observe(s);
    expect(r.state).toBe(PlayState.UNKNOWN);
  });

  it('a vanished process is definitively over', async () => {
    const r = await observe(source(makeKiosk(PKG), makeAdb({ pid: null })));
    expect(r.state).toBe(PlayState.PAUSED);
    expect(r.content).toBeNull();
    expect(r.loaded).toBe(false);
  });
});

describe('observation source — active RetroArch log identity', () => {
  it('uses the current log as load identity and prefers its catalog match over launch intent', async () => {
    const log = {
      file: 'retroarch__2026_09_11__19_36_41.log',
      startedAt: '2026-09-11T19:36:41',
      contentPath: '/Games/GB/Pokemon Crystal.gbc',
      corePath: '/cores/gambatte.so',
    };
    const identified = { contentId: 'arcade:gb/pokemon-crystal', title: 'Pokémon Crystal', console: 'gb' };
    const s = source(makeKiosk(PKG), makeAdb({ ticks: [100] }), {
      logReader: { readCurrentSession: async () => log },
      resolveContent: (path) => path === log.contentPath ? identified : null,
    });
    const r = await observe(s);
    expect(r).toMatchObject({
      state: PlayState.UNKNOWN,
      loaded: true,
      loadId: log.file,
      loadedAt: log.startedAt,
      content: identified,
    });
  });

  it('still identifies a loaded game when its ROM is absent from the catalog', async () => {
    const log = {
      file: 'retroarch__2026_09_11__19_36_41.log', startedAt: '2026-09-11T19:36:41',
      contentPath: '/Games/Homebrew/Unknown.gba', corePath: '/cores/mgba.so',
    };
    const s = source(makeKiosk(PKG), makeAdb({ ticks: [100] }), {
      logReader: { readCurrentSession: async () => log }, resolveContent: () => null,
    });
    const r = await observe(s);
    expect(r.loaded).toBe(true);
    expect(r.loadId).toBe(log.file);
    expect(r.content).toBeNull();
  });
});

describe('observation source — degraded operation', () => {
  it('without ADB it trusts foreground but flags the loss of confirmation', async () => {
    const r = await observe(source(makeKiosk(PKG), makeAdb({ available: false })));
    expect(r.state).toBe(PlayState.PLAYING);
    expect(r.degraded).toBe(true);
    expect(r.channel).toBe('kiosk');
  });

  it('works with no ADB adapter configured at all', async () => {
    const s = new RetroArchPlayObservationSource({
      kioskClient: makeKiosk(PKG), packageName: PKG, logger: { debug() {} },
    });
    const r = await observe(s);
    expect(r.state).toBe(PlayState.PLAYING);
    expect(r.degraded).toBe(true);
  });
});
