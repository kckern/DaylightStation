import { afterEach, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { SchoolSurfaceProvider, useSchoolSurface } from '../portal/SchoolSurface.jsx';
import { schoolApi } from '../schoolApi.js';
import { languageApi } from '../Programs/SentenceLadder/languageApi.js';
import { setSchoolDeviceId } from '../schoolDevice.js';
import { useSchoolApi } from './useSchoolApi.js';
import { useLanguageApi } from './useSchoolFeatureApi.js';

let probes;
function Probe({ name }) {
  probes[name] = { surface: useSchoolSurface(), api: useSchoolApi(), language: useLanguageApi() };
  return null;
}
const mount = () => {
  probes = {};
  return render(<>
    <SchoolSurfaceProvider surfaceId="browser-one"><Probe name="one" /></SchoolSurfaceProvider>
    <SchoolSurfaceProvider surfaceId="browser-two"><Probe name="two" /></SchoolSurfaceProvider>
  </>);
};
afterEach(() => { vi.unstubAllGlobals(); setSchoolDeviceId(null); });

it('owns separate stable API and feature transports for simultaneous null-device hosted surfaces', async () => {
  const view = mount();
  expect(probes.one.surface.resourceStore).not.toBe(probes.two.surface.resourceStore);
  expect(probes.one.api).not.toBe(schoolApi);
  expect(probes.one.api).not.toBe(probes.two.api);
  expect(probes.one.api.transport).not.toBe(probes.two.api.transport);
  expect(probes.one.language).not.toBe(languageApi);
  expect(probes.one.language).not.toBe(probes.two.language);
  const first = probes.one.api;
  view.rerender(<><SchoolSurfaceProvider surfaceId="browser-one"><Probe name="one" /></SchoolSurfaceProvider><SchoolSurfaceProvider surfaceId="browser-two"><Probe name="two" /></SchoolSurfaceProvider></>);
  expect(probes.one.api).toBe(first);
});

it('hosted null-device requests cannot inherit the mutable legacy browser device header', async () => {
  const requests = [];
  vi.stubGlobal('fetch', async (url, options) => {
    requests.push({ url, headers: options.headers });
    return new Response('[]', { status: 200 });
  });
  setSchoolDeviceId('unrelated-legacy-device');
  mount();
  await probes.one.api.roster();
  await probes.two.language.courses();
  expect(requests).toHaveLength(2);
  expect(requests.map(request => request.headers?.['X-Daylight-Device'])).toEqual([undefined, undefined]);
});

it('a feature write on one null-device surface invalidates its School read without altering another surface request', async () => {
  const pending = [];
  const fetchImpl = vi.fn(() => new Promise(resolve => pending.push(resolve)));
  vi.stubGlobal('fetch', fetchImpl);
  const answer = (i, data) => pending[i]({ ok: true, status: 200, json: async () => data });
  mount();
  try {
    const oldA = probes.one.api.roster();
    const oldB = probes.two.api.roster();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const write = probes.one.language.pacing('kid', 'korean', 1, 'grant');
    answer(2, { saved: true }); await write;
    const newA = probes.one.api.roster();
    const sharedB = probes.two.api.roster();
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    answer(0, ['old-a']); answer(1, ['b']); answer(3, ['new-a']);
    await oldA;
    expect((await newA).data).toEqual(['new-a']);
    expect((await oldB).data).toEqual(['b']);
    expect((await sharedB).data).toEqual(['b']);
  } finally { pending.forEach(resolve => resolve({ ok: true, status: 200, json: async () => [] })); }
});

it('keeps legacy singleton fallback only for consumers without a School host', () => {
  probes = {};
  render(<Probe name="unhosted" />);
  expect(probes.unhosted.surface.provided).toBe(false);
  expect(probes.unhosted.api).toBe(schoolApi);
  expect(probes.unhosted.language).toBe(languageApi);
});
