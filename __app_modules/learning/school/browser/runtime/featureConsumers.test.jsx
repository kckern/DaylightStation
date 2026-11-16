import { afterEach, expect, it, vi } from 'vitest';
import { render, renderHook, waitFor } from '@testing-library/react';
import { SchoolSurfaceProvider } from '../portal/SchoolSurface.jsx';
import GratitudeProgram from '../Programs/Gratitude/GratitudeProgram.jsx';
import { useRoster } from '../admin/useRoster.js';

afterEach(() => vi.unstubAllGlobals());

it('two mounted Gratitude programs send their own surface device and preserve their grants', async () => {
  const requests = [];
  vi.stubGlobal('fetch', async (url, options) => {
    requests.push({ url, headers: options.headers });
    return new Response(JSON.stringify({ phase: 'completed', subject: 'A kind act', studyDay: '2026-11-16', serverNow: '2026-11-16T12:00:00Z' }), { status: 200 });
  });
  render(<>
    <SchoolSurfaceProvider surfaceId="left" deviceId="device-left"><GratitudeProgram learnerId="kid" gratitudeGrant="grant-left" today="2026-11-16" /></SchoolSurfaceProvider>
    <SchoolSurfaceProvider surfaceId="right" deviceId="device-right"><GratitudeProgram learnerId="kid" gratitudeGrant="grant-right" today="2026-11-16" /></SchoolSurfaceProvider>
  </>);
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests.map(request => [request.headers['X-Daylight-Device'], request.headers['X-School-Gratitude-Grant']])).toEqual([
    ['device-left', 'grant-left'], ['device-right', 'grant-right'],
  ]);
});

it('the real parent roster read carries its mounted surface scope', async () => {
  const requests = [];
  vi.stubGlobal('fetch', async (url, options) => { requests.push(options); return new Response('[]', { status: 200 }); });
  const wrapper = ({ children }) => <SchoolSurfaceProvider surfaceId="teacher" deviceId="teacher-device">{children}</SchoolSurfaceProvider>;
  const { result } = renderHook(useRoster, { wrapper });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(requests[0].headers['X-Daylight-Device']).toBe('teacher-device');
});

it('the installed practice browser reads through its own surface client', async () => {
  const { default: BankBrowser } = await import('../browse/BankBrowser.jsx');
  const requests = [];
  vi.stubGlobal('fetch', async (_url, options) => { requests.push(options); return new Response('[]', { status: 200 }); });
  render(<SchoolSurfaceProvider surfaceId="practice" deviceId="practice-device"><BankBrowser /></SchoolSurfaceProvider>);
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0].headers['X-Daylight-Device']).toBe('practice-device');
});
