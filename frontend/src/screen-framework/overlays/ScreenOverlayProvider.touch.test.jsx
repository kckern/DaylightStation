import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ScreenOverlayProvider, useScreenOverlay } from './ScreenOverlayProvider.jsx';
import { useHasMenuNavigationContext, useMenuNavigationContext } from '../../context/MenuNavigationContext.jsx';

// The provider is used both standalone (tests) and nested inside a real
// MenuNavigationProvider (ScreenRenderer.jsx). Mock the nav context module so
// each test can control whether nav context exists and what it reports,
// without needing a real MenuNavigationProvider ancestor.
vi.mock('../../context/MenuNavigationContext.jsx', () => ({
  useHasMenuNavigationContext: vi.fn(() => false),
  useMenuNavigationContext: vi.fn(() => ({ currentContent: null })),
}));

function Dummy() { return <div data-testid="dummy">content</div>; }

// Exposes showOverlay to the test without needing a real screen.
let api;
function Harness() {
  api = useScreenOverlay();
  return null;
}

function renderWith(inputType) {
  return render(
    <ScreenOverlayProvider inputType={inputType}>
      <Harness />
    </ScreenOverlayProvider>
  );
}

describe('ScreenOverlayProvider touch chrome', () => {
  beforeEach(() => {
    // Default: no nav context present (matches standalone-provider tests).
    vi.mocked(useHasMenuNavigationContext).mockReturnValue(false);
    vi.mocked(useMenuNavigationContext).mockReturnValue({ currentContent: null });
  });

  it('renders no chrome and no touch shell when input is not touch', () => {
    const { container } = renderWith('remote');
    act(() => { api.showOverlay(Dummy, {}, { chrome: 'media' }); });
    expect(screen.getByTestId('dummy')).toBeInTheDocument();
    expect(screen.queryByTestId('touch-chrome-back')).toBeNull();
    expect(container.querySelector('.screen-overlay--touch-shell')).toBeNull();
  });

  it('renders Back-only chrome by default on a touch screen', () => {
    renderWith('touch');
    act(() => { api.showOverlay(Dummy, {}); });
    expect(screen.getByTestId('touch-chrome-back')).toBeInTheDocument();
    expect(screen.queryByTestId('touch-chrome-playpause')).toBeNull();
  });

  it('renders media chrome when the overlay declares it', () => {
    renderWith('touch');
    act(() => { api.showOverlay(Dummy, {}, { chrome: 'media' }); });
    expect(screen.getByTestId('touch-chrome-playpause')).toBeInTheDocument();
  });

  // Core behavioural change: the lane is screen-level now, not overlay-only.
  // A touch screen with nothing showing (no overlay, no nav content) still
  // gets the Back button -- there is no state in which a touch user is
  // stranded without any way back.
  it('renders the lane with Back chrome on a touch screen even with no overlay and no nav context', () => {
    renderWith('touch');
    expect(screen.getByTestId('touch-chrome-back')).toBeInTheDocument();
  });

  it('shows back-only mode (no transport) on a touch screen with no overlay', () => {
    renderWith('touch');
    expect(screen.queryByTestId('touch-chrome-playpause')).toBeNull();
  });

  // Regression case this task exists to fix: MenuStack pushes the Player onto
  // the MenuNavigation nav stack directly (MenuStack.jsx:126), not via
  // showOverlay, so there is no fullscreen record at all. The lane must still
  // detect "media" mode from currentContent.
  it('nav-stack currentContent of type player yields media mode with no fullscreen overlay', () => {
    vi.mocked(useHasMenuNavigationContext).mockReturnValue(true);
    vi.mocked(useMenuNavigationContext).mockReturnValue({ currentContent: { type: 'player', props: {} } });
    renderWith('touch');
    expect(screen.getByTestId('touch-chrome-playpause')).toBeInTheDocument();
  });

  it('nav-stack currentContent of type menu yields back mode (no transport)', () => {
    vi.mocked(useHasMenuNavigationContext).mockReturnValue(true);
    vi.mocked(useMenuNavigationContext).mockReturnValue({ currentContent: { type: 'menu', props: {} } });
    renderWith('touch');
    expect(screen.getByTestId('touch-chrome-back')).toBeInTheDocument();
    expect(screen.queryByTestId('touch-chrome-playpause')).toBeNull();
  });
});
