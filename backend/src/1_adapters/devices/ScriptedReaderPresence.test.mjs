import { describe, it, expect, beforeEach } from 'vitest';
import { ScriptedReaderPresence } from './ScriptedReaderPresence.mjs';

const quiet = { warn() {} };
let called;
const haGateway = { callService: async (d, s) => { called.push(`${d}.${s}`); } };
beforeEach(() => { called = []; });

describe('ScriptedReaderPresence', () => {
  it('runs the configured scripts', async () => {
    const p = new ScriptedReaderPresence({
      haGateway, raiseScript: 'script.garage_screen_on', releaseScript: 'script.garage_screen_off', logger: quiet,
    });
    expect(await p.raise()).toEqual({ ok: true });
    expect(await p.release()).toEqual({ ok: true });
    expect(called).toEqual(['script.garage_screen_on', 'script.garage_screen_off']);
  });

  it('treats a bare name as a script', async () => {
    const p = new ScriptedReaderPresence({ haGateway, raiseScript: 'garage_on', logger: quiet });
    await p.raise();
    expect(called).toEqual(['script.garage_on']);
  });

  it('succeeds with nothing configured — an always-on screen is a valid setup', async () => {
    const p = new ScriptedReaderPresence({ haGateway, logger: quiet });
    expect(await p.raise()).toEqual({ ok: true });
    expect(await p.release()).toEqual({ ok: true });
    expect(called).toEqual([]);
  });

  it('reports a failure rather than throwing', async () => {
    const broken = { callService: async () => { throw new Error('ha down'); } };
    const p = new ScriptedReaderPresence({ haGateway: broken, raiseScript: 'script.x', logger: quiet });
    const r = await p.raise();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ha down/);
  });

  it('says why the screen came on, so walking in is not a puzzle', async () => {
    const said = [];
    const p = new ScriptedReaderPresence({
      haGateway, raiseScript: 'script.x', speaker: { say: async (d, t) => said.push([d, t]) },
      speakerDeviceId: 'garage-tv', logger: quiet,
    });
    await p.raise('Scan to play Test Game');
    expect(said).toEqual([['garage-tv', 'Scan to play Test Game']]);
  });

  it('a mute speaker never fails the wake', async () => {
    const p = new ScriptedReaderPresence({
      haGateway, raiseScript: 'script.x',
      speaker: { say: async () => { throw new Error('mute'); } }, speakerDeviceId: 'garage-tv', logger: quiet,
    });
    expect(await p.raise('hello')).toEqual({ ok: true });
  });
});
