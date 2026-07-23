import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { ScreenOverlayProvider, useScreenOverlay } from './ScreenOverlayProvider.jsx';
import { useHasMenuNavigationContext, useMenuNavigationContext } from '../../context/MenuNavigationContext.jsx';
import { getActionBus } from '../input/ActionBus.js';

// The provider emits `screen:overlay-mounted` on the real bus; mock it so the
// surface-tap tests can assert on emissions without side effects.
vi.mock('../input/ActionBus.js', () => {
  const emit = vi.fn();
  return { getActionBus: () => ({ emit }) };
});

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

  // The lane is CONTENT-only: with nothing over the screen's own layout there
  // is nothing to get back OUT of, and the layout (the Portal's School app)
  // owns its own header and back-navigation. Drawing the lane there only cost
  // 80px of an 800px panel and letterboxed 16:9 video.
  it('draws no lane on a touch screen with no overlay and no nav content', () => {
    const { container } = renderWith('touch');
    expect(screen.queryByTestId('touch-chrome-back')).toBeNull();
    // The shell itself still wraps the screen — only the lane is absent.
    expect(container.querySelector('.screen-overlay--touch-content')).toBeInTheDocument();
  });

  it('draws the lane again as soon as an overlay covers the layout', () => {
    renderWith('touch');
    act(() => { api.showOverlay(Dummy, {}); });
    expect(screen.getByTestId('touch-chrome-back')).toBeInTheDocument();
    act(() => { api.dismissOverlay('fullscreen'); });
    expect(screen.queryByTestId('touch-chrome-back')).toBeNull();
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

// The whole content surface doubles as a play/pause target on touch screens,
// so a user watching something can tap anywhere rather than hunting for the
// 60px disc. Arming it is mode-gated for a correctness reason, not comfort.
describe('ScreenOverlayProvider touch surface play/pause', () => {
  beforeEach(() => {
    vi.mocked(useHasMenuNavigationContext).mockReturnValue(false);
    vi.mocked(useMenuNavigationContext).mockReturnValue({ currentContent: null });
    getActionBus().emit.mockClear();
  });

  it('emits a play/pause toggle when the surface is tapped in media mode', () => {
    const { container } = renderWith('touch');
    act(() => { api.showOverlay(Dummy, {}, { chrome: 'media' }); });

    fireEvent.click(container.querySelector('.screen-overlay--touch-content'));

    expect(getActionBus().emit).toHaveBeenCalledWith('media:playback', { command: 'toggle' });
  });

  it('stays disarmed while browsing, so a stray tap cannot activate a menu item', () => {
    // toggle becomes a synthetic Enter downstream; on a menu Enter launches the
    // highlighted item. Browsing must never arm the surface.
    const { container } = renderWith('touch');

    fireEvent.click(container.querySelector('.screen-overlay--touch-content'));

    expect(getActionBus().emit).not.toHaveBeenCalledWith('media:playback', { command: 'toggle' });
  });

  it('stays disarmed for nav-stack browse content', () => {
    vi.mocked(useHasMenuNavigationContext).mockReturnValue(true);
    vi.mocked(useMenuNavigationContext).mockReturnValue({ currentContent: { type: 'menu' } });
    const { container } = renderWith('touch');

    fireEvent.click(container.querySelector('.screen-overlay--touch-content'));

    expect(getActionBus().emit).not.toHaveBeenCalledWith('media:playback', { command: 'toggle' });
  });

  it('arms for a nav-stack player even with no fullscreen overlay', () => {
    vi.mocked(useHasMenuNavigationContext).mockReturnValue(true);
    vi.mocked(useMenuNavigationContext).mockReturnValue({ currentContent: { type: 'player' } });
    const { container } = renderWith('touch');

    fireEvent.click(container.querySelector('.screen-overlay--touch-content'));

    expect(getActionBus().emit).toHaveBeenCalledWith('media:playback', { command: 'toggle' });
  });

  it('ignores taps that land on a control, so seeking does not also toggle', () => {
    function WithControls() {
      return (
        <div>
          <div className="seek-bar" data-testid="seek" />
          <button data-testid="inner-btn">go</button>
          <span data-testid="plain">plain</span>
        </div>
      );
    }
    render(
      <ScreenOverlayProvider inputType="touch">
        <Harness />
        <WithControls />
      </ScreenOverlayProvider>
    );
    act(() => { api.showOverlay(Dummy, {}, { chrome: 'media' }); });

    fireEvent.click(screen.getByTestId('seek'));
    expect(getActionBus().emit).not.toHaveBeenCalledWith('media:playback', { command: 'toggle' });

    fireEvent.click(screen.getByTestId('inner-btn'));
    expect(getActionBus().emit).not.toHaveBeenCalledWith('media:playback', { command: 'toggle' });

    // A non-interactive descendant still toggles — that is the whole point.
    fireEvent.click(screen.getByTestId('plain'));
    expect(getActionBus().emit).toHaveBeenCalledWith('media:playback', { command: 'toggle' });
  });

  it('never arms on a non-touch screen', () => {
    const { container } = renderWith('remote');
    act(() => { api.showOverlay(Dummy, {}, { chrome: 'media' }); });

    expect(container.querySelector('.screen-overlay--touch-content')).toBeNull();
    expect(getActionBus().emit).not.toHaveBeenCalledWith('media:playback', { command: 'toggle' });
  });
});
