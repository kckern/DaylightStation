import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SchoolSurfaceProvider } from '../portal/SchoolSurface.jsx';
import { useSchoolCatalog } from './useSchoolCatalog.js';

const wrapper = ({ children }) => <SchoolSurfaceProvider surfaceId="catalog-test">{children}</SchoolSurfaceProvider>;
const ok = data => ({ ok: true, status: 200, data });

it('makes the fast catalogues available without waiting for question banks', async () => {
  let answerBanks;
  const api = { materials: async () => ok({ materials: [{ id: 'material' }] }), banks: () => new Promise(resolve => { answerBanks = resolve; }) };
  const languageApi = { courses: async () => ok([{ id: 'course' }]) };
  const { result } = renderHook(() => useSchoolCatalog({ api, languageApi }), { wrapper });
  await waitFor(() => expect(result.current.catalogLoaded).toBe(true));
  expect(result.current.materials).toEqual([{ id: 'material' }]);
  expect(result.current.courses).toEqual([{ id: 'course' }]);
  expect(result.current.banks).toEqual([]);
  await act(async () => answerBanks(ok([{ id: 'bank' }])));
  expect(result.current.banks).toEqual([{ id: 'bank' }]);
});

it('exposes failed catalogues and retries them, preserving useful data', async () => {
  const api = { materials: vi.fn().mockResolvedValueOnce({ ok: false, status: 503, data: null }).mockResolvedValue(ok({ materials: [{ id: 'restored' }] })), banks: async () => ok([]) };
  const languageApi = { courses: async () => ok([{ id: 'course' }]) };
  const { result } = renderHook(() => useSchoolCatalog({ api, languageApi }), { wrapper });
  await waitFor(() => expect(result.current.error).toMatchObject({ resource: 'materials', status: 503 }));
  expect(result.current.courses).toEqual([{ id: 'course' }]);
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.materials).toEqual([{ id: 'restored' }]));
  expect(result.current.error).toBeNull();
});

it('does not mistake malformed successful catalogue payloads for a quiet empty library', async () => {
  const api = { materials: async () => ok({}), banks: async () => ok([]) };
  const { result } = renderHook(() => useSchoolCatalog({ api, languageApi: { courses: async () => ok([]) } }), { wrapper });
  await waitFor(() => expect(result.current.error).toMatchObject({ resource: 'materials', kind: 'invalid-data' }));
});

it('does no catalogue requests when disabled', () => {
  const load = vi.fn();
  const { result } = renderHook(() => useSchoolCatalog({ enabled: false, api: { materials: load, banks: load }, languageApi: { courses: load } }), { wrapper });
  expect(load).not.toHaveBeenCalled(); expect(result.current.catalogLoaded).toBe(false);
});
