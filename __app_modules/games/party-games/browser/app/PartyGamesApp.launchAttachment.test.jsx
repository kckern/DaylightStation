import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import PartyGamesApp from './PartyGamesApp.jsx';
import { fetchBoot } from './sessionClient.js';
vi.mock('./sessionClient.js', async original => ({ ...await original(), fetchBoot: vi.fn(), createSession: vi.fn() }));
vi.mock('@/hooks/useWebSocket.js', () => ({ useWebSocketStatus: () => ({ connected: true }), useWebSocketSubscription: () => {} }));
vi.mock('../../../../../__capabilities/screen-host/browser/input.mjs', () => ({
  useScopedRemoteControls: () => {}, acquireGamepadInputHost: () => ({ release() {} }),
  bindNextGamepadPress: () => {}, cancelPendingGamepadBind: () => {}, clearGamepadRoleBindings: () => {},
  getActionBus: () => ({ subscribe: () => () => {} }),
}));
beforeEach(() => {
  window.localStorage.clear();
  fetchBoot.mockReset().mockImplementation(() => new Promise(() => {}));
});
it.each(['session=jeremiah-session', 'diagnostic_session=jeremiah-diagnostic'])(
  'ignores unrelated admin preview URL attachment %s', async query => {
    window.history.replaceState({}, '', `/admin/content/lists/menus/fhe?${query}`);
    render(<PartyGamesApp definitionId="jeopardy:practice-isaiah" />);
    await waitFor(() => expect(fetchBoot).toHaveBeenCalled());
    expect(fetchBoot).toHaveBeenCalledWith({ diagnosticSessionId: null, sessionId: null });
  },
);
it('preserves an explicit attachment on a direct game route', async () => {
  window.history.replaceState({}, '', '/screens/living-room/party-games/jeopardy:practice-isaiah?session=isaiah-session');
  render(<PartyGamesApp definitionId="jeopardy:practice-isaiah" />);
  await waitFor(() => expect(fetchBoot).toHaveBeenCalledWith({ diagnosticSessionId: null, sessionId: 'isaiah-session' }));
});
