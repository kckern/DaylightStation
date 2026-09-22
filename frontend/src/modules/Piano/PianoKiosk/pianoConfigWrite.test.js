import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));

import { setPianoConfigValue, writePianoConfigValue } from './pianoConfigWrite.js';

const MULTI = `# household pianos
pianos:
  yellow-room:
    label: Yellow room  # the upright
    effects:
      resend: 2
  garage:
    label: Garage
curfew:
  enabled: true
`;

describe('setPianoConfigValue', () => {
  it('writes under pianos.{id} when that piano has a block, keeping comments', () => {
    const r = setPianoConfigValue(MULTI, 'yellow-room', ['timing', 'clickLeadMs'], 280);
    expect(r.path).toBe('pianos.yellow-room.timing.clickLeadMs');
    expect(r.parsed.pianos['yellow-room'].timing).toEqual({ clickLeadMs: 280 });
    expect(r.parsed.pianos.garage.timing).toBeUndefined();
    expect(r.raw).toContain('# household pianos');
    expect(r.raw).toContain('# the upright');
  });

  it('overwrites an existing value in place', () => {
    const once = setPianoConfigValue(MULTI, 'garage', ['timing', 'clickLeadMs'], 100).raw;
    const twice = setPianoConfigValue(once, 'garage', ['timing', 'clickLeadMs'], 240);
    expect(twice.parsed.pianos.garage.timing.clickLeadMs).toBe(240);
    expect(twice.raw.match(/clickLeadMs/g)).toHaveLength(1);
  });

  it('writes on the shared top level for the synthesized default piano', () => {
    const r = setPianoConfigValue('label: Piano\n', 'default', ['timing', 'clickLeadMs'], 300);
    expect(r.path).toBe('timing.clickLeadMs');
    expect(r.parsed).toEqual({ label: 'Piano', timing: { clickLeadMs: 300 } });
  });

  it('refuses invalid YAML', () => {
    expect(() => setPianoConfigValue('a: [1,', 'default', ['timing', 'clickLeadMs'], 1)).toThrow(/not valid YAML/);
  });
});

describe('writePianoConfigValue', () => {
  it('GETs the raw file and PUTs the edited raw back', async () => {
    const api = vi.fn(async (path, body, method) => (method === 'PUT' ? { ok: true } : { raw: MULTI, parsed: {} }));
    const r = await writePianoConfigValue({ pianoId: 'garage', keyPath: ['timing', 'clickLeadMs'], value: 210, api });
    expect(r.path).toBe('pianos.garage.timing.clickLeadMs');
    expect(api).toHaveBeenLastCalledWith('api/v1/admin/apps/piano/config', { raw: expect.stringContaining('clickLeadMs: 210') }, 'PUT');
  });

  it('never writes when the current file could not be read', async () => {
    const api = vi.fn(async () => ({}));
    await expect(writePianoConfigValue({ pianoId: 'garage', keyPath: ['timing', 'clickLeadMs'], value: 1, api })).rejects.toThrow(/could not read/);
    expect(api).toHaveBeenCalledTimes(1);
  });
});
