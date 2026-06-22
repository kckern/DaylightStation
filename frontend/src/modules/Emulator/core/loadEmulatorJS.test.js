import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildEjsGlobals, loadEmulatorJS, _resetLoaderForTests } from './loadEmulatorJS.js';

describe('buildEjsGlobals', () => {
  it('returns correct EJS_* keys with defaults', () => {
    const onReady = () => {};
    const onGameStart = () => {};
    const g = buildEjsGlobals({
      player: '#mount',
      romUrl: 'http://x/rom.gb',
      pathtodata: 'http://x/data/',
      onReady,
      onGameStart,
    });
    expect(g.EJS_player).toBe('#mount');
    expect(g.EJS_core).toBe('gb');
    expect(g.EJS_gameUrl).toBe('http://x/rom.gb');
    expect(g.EJS_pathtodata).toBe('http://x/data/');
    expect(g.EJS_startOnLoaded).toBe(true);
    expect(g.EJS_threads).toBe(false);
    expect(g.EJS_ready).toBe(onReady);
    expect(g.EJS_onGameStart).toBe(onGameStart);
    expect('EJS_DEBUG_XX' in g).toBe(false);
  });

  it('normalizes pathtodata to end with a trailing slash', () => {
    const g = buildEjsGlobals({
      player: '#m',
      romUrl: 'r',
      pathtodata: 'http://x/data',
    });
    expect(g.EJS_pathtodata).toBe('http://x/data/');
  });

  it('accepts a custom core', () => {
    const g = buildEjsGlobals({ player: '#m', romUrl: 'r', pathtodata: 'd/', core: 'nes' });
    expect(g.EJS_core).toBe('nes');
  });

  it('throws when romUrl is missing', () => {
    expect(() => buildEjsGlobals({ player: '#m', pathtodata: 'd/' })).toThrow();
  });

  it('throws when pathtodata is missing', () => {
    expect(() => buildEjsGlobals({ player: '#m', romUrl: 'r' })).toThrow();
  });

  it('throws when player is missing', () => {
    expect(() => buildEjsGlobals({ romUrl: 'r', pathtodata: 'd/' })).toThrow();
  });

  it('includes EJS_defaultControls when controls provided', () => {
    const controls = { 0: { 4: { value: 'up arrow', value2: 'DPAD_UP' } }, 1: {}, 2: {}, 3: {} };
    const g = buildEjsGlobals({ player: '#m', romUrl: 'r', pathtodata: 'd/', controls });
    expect(g.EJS_defaultControls).toBe(controls);
  });

  it('omits EJS_defaultControls when no controls provided', () => {
    const g = buildEjsGlobals({ player: '#m', romUrl: 'r', pathtodata: 'd/' });
    expect('EJS_defaultControls' in g).toBe(false);
  });
});

function makeFakeWin() {
  const head = {
    children: [],
    appendChild(node) { this.children.push(node); },
  };
  const doc = {
    _byId: {},
    getElementById(id) { return this._byId[id] || null; },
    createElement() {
      return { tagName: 'SCRIPT', id: '', src: '', onerror: null, onload: null };
    },
    head,
  };
  return { document: doc };
}

describe('loadEmulatorJS', () => {
  beforeEach(() => {
    _resetLoaderForTests();
  });

  it('assigns globals and injects exactly one #ejs-loader script', async () => {
    const win = makeFakeWin();
    const p = loadEmulatorJS({
      player: '#mount',
      romUrl: 'http://x/rom.gb',
      pathtodata: 'http://x/data',
      win,
    });
    // Globals assigned
    expect(win.EJS_player).toBe('#mount');
    expect(win.EJS_gameUrl).toBe('http://x/rom.gb');
    expect(win.EJS_pathtodata).toBe('http://x/data/');
    expect(typeof win.EJS_onGameStart).toBe('function');
    // Script injected once
    const scripts = win.document.head.children.filter((c) => c.id === 'ejs-loader');
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe('http://x/data/loader.js');

    // Resolve via lifecycle callback
    const fakeInstance = { id: 'emu' };
    win.EJS_emulator = fakeInstance;
    win.EJS_onGameStart();
    await expect(p).resolves.toBe(fakeInstance);
  });

  it('threads controls through to EJS_defaultControls on the window', () => {
    const win = makeFakeWin();
    const controls = { 0: { 8: { value: 'x', value2: 'BUTTON_1' } }, 1: {}, 2: {}, 3: {} };
    loadEmulatorJS({ player: '#m', romUrl: 'r', pathtodata: 'd', win, controls });
    expect(win.EJS_defaultControls).toBe(controls);
  });

  it('memoizes: a second call returns the same promise', async () => {
    const win = makeFakeWin();
    const p1 = loadEmulatorJS({ player: '#m', romUrl: 'r', pathtodata: 'd', win });
    const p2 = loadEmulatorJS({ player: '#m', romUrl: 'r', pathtodata: 'd', win });
    expect(p1).toBe(p2);
    // only one script injected
    const scripts = win.document.head.children.filter((c) => c.id === 'ejs-loader');
    expect(scripts).toHaveLength(1);
  });

  it('rejects on script error', async () => {
    const win = makeFakeWin();
    const p = loadEmulatorJS({ player: '#m', romUrl: 'r', pathtodata: 'd', win });
    const script = win.document.head.children.find((c) => c.id === 'ejs-loader');
    script.onerror(new Error('boom'));
    await expect(p).rejects.toThrow();
  });

  it('rejects on timeout', async () => {
    vi.useFakeTimers();
    const win = makeFakeWin();
    const p = loadEmulatorJS({ player: '#m', romUrl: 'r', pathtodata: 'd', win, timeoutMs: 1000 });
    const assertion = expect(p).rejects.toThrow(/timeout/i);
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
    vi.useRealTimers();
  });
});
