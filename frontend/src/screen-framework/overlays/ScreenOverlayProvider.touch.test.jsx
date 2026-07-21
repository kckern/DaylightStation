import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ScreenOverlayProvider, useScreenOverlay } from './ScreenOverlayProvider.jsx';

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
  it('renders no chrome when input is not touch', () => {
    renderWith('remote');
    act(() => { api.showOverlay(Dummy, {}, { chrome: 'media' }); });
    expect(screen.getByTestId('dummy')).toBeInTheDocument();
    expect(screen.queryByTestId('touch-chrome-back')).toBeNull();
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

  it('renders no chrome when there is no overlay', () => {
    renderWith('touch');
    expect(screen.queryByTestId('touch-chrome-back')).toBeNull();
  });
});
