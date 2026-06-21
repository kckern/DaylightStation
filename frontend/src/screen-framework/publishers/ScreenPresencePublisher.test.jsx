import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MenuNavigationProvider, useMenuNavigationContext } from '../../context/MenuNavigationContext.jsx';
import { ScreenOverlayProvider } from '../overlays/ScreenOverlayProvider.jsx';

vi.mock('../../services/WebSocketService.js', () => ({ wsService: { send: vi.fn() } }));
const { wsService } = await import('../../services/WebSocketService.js');
const { ScreenPresencePublisher } = await import('./ScreenPresencePublisher.jsx');

let navApi = null;
function NavCapture() { navApi = useMenuNavigationContext(); return null; }

const setup = (deviceId) =>
  render(
    <MenuNavigationProvider>
      <ScreenOverlayProvider>
        <NavCapture />
        <ScreenPresencePublisher deviceId={deviceId} />
      </ScreenOverlayProvider>
    </MenuNavigationProvider>
  );

beforeEach(() => { wsService.send.mockClear(); navApi = null; });
const lastMsg = () => wsService.send.mock.calls.at(-1)?.[0];

describe('ScreenPresencePublisher', () => {
  it('reports active=false on the bare dashboard', () => {
    setup('office-tv');
    expect(lastMsg()).toMatchObject({ deviceId: 'office-tv', active: false });
  });

  it('reports active=true when a player is pushed onto the nav stack', () => {
    setup('office-tv');
    act(() => { navApi.push({ type: 'player', props: {} }); });
    expect(lastMsg()).toMatchObject({ active: true });
  });

  it('renders nothing and never sends without a deviceId', () => {
    setup(null);
    expect(wsService.send).not.toHaveBeenCalled();
  });
});
