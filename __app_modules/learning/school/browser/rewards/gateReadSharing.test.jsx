import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { SchoolSurfaceProvider } from '../portal/SchoolSurface.jsx';
import AgendaStatusBoard from '../status/AgendaStatusBoard.jsx';
import useRewardsCache from './useRewardsCache.js';
import { schoolApi } from '../schoolApi.js';
vi.mock('../schoolApi.js', () => { const endpoints = { schoolApi: {
  stateGates: vi.fn(), earningsRoster: vi.fn(), gems: vi.fn(), wallet: vi.fn(), teacherDay: vi.fn(), agendaPreview: vi.fn(),
} }; return { ...endpoints, createSchoolApi: () => ({ ...endpoints.schoolApi }) }; });
vi.mock('../../../../../frontend/src/hooks/useWebSocket.js', () => ({ useWebSocketSubscription: vi.fn() }));
vi.mock('../../../../../frontend/src/services/WebSocketService.js', async () => {
  const { createSchoolRealtimeSource } = await import('#testlib/school/realtimeSource.mjs');
  return { wsService: createSchoolRealtimeSource() };
});
const NO_KIDS = [];
function Rewards() { useRewardsCache([{ id: 'one' }], true); return null; }
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks();
  schoolApi.earningsRoster.mockResolvedValue({ ok: true, data: { learners: [] } });
  schoolApi.gems.mockResolvedValue({ ok: true, data: { mode: 'off', categories: [] } });
  schoolApi.wallet.mockResolvedValue({ ok: true, data: { balances: { gold: 0 } } });
});
it('shares the authoritative in-flight gate projection between board and rewards on one surface', async () => {
  let finish;
  schoolApi.stateGates.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(<SchoolSurfaceProvider surfaceId="portal"><Rewards /><AgendaStatusBoard kids={NO_KIDS} /></SchoolSurfaceProvider>);
  await act(async () => {});
  expect(schoolApi.stateGates).toHaveBeenCalledTimes(1);
  await act(async () => { finish({ ok: true, data: { items: [] } }); });
});
it('keeps gate reads independent across two mounted surfaces', async () => {
  schoolApi.stateGates.mockResolvedValue({ ok: true, data: { items: [] } });
  render(<><SchoolSurfaceProvider surfaceId="left"><AgendaStatusBoard kids={NO_KIDS} /></SchoolSurfaceProvider><SchoolSurfaceProvider surfaceId="right"><AgendaStatusBoard kids={NO_KIDS} /></SchoolSurfaceProvider></>);
  await waitFor(() => expect(schoolApi.stateGates).toHaveBeenCalledTimes(2));
});
