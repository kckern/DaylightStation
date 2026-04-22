// frontend/src/screen-framework/pip/PipManager.test.jsx
import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React, { useEffect, useRef } from 'react';
import { ScreenOverlayProvider, useScreenOverlay } from '../overlays/ScreenOverlayProvider.jsx';
import { PipManager, usePip } from './PipManager.jsx';

function MockCameraOverlay() {
  return <div data-testid="camera-overlay">camera</div>;
}

function SlotRegistrar({ slotId }) {
  const { registerSlot, unregisterSlot } = usePip();
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) registerSlot(slotId, ref.current);
    return () => unregisterSlot(slotId);
  }, [slotId, registerSlot, unregisterSlot]);
  return <div ref={ref} data-testid={`slot-${slotId}`} style={{ width: 100, height: 100 }} />;
}

function Handles({ onReady }) {
  const overlay = useScreenOverlay();
  const pip = usePip();
  useEffect(() => { onReady({ overlay, pip }); }, [onReady, overlay, pip]);
  return null;
}

function setup() {
  let handles = null;
  const onReady = (h) => { handles = h; };
  render(
    <ScreenOverlayProvider>
      <PipManager config={{ position: 'bottom-right', size: 25, margin: 16 }}>
        <SlotRegistrar slotId="main-content" />
        <Handles onReady={onReady} />
      </PipManager>
    </ScreenOverlayProvider>
  );
  return () => handles;
}

describe('PipManager — fullscreen-aware fallback', () => {
  it('falls back to corner mode when panel mode is requested while a fullscreen overlay is active', () => {
    const getHandles = setup();

    // Activate a fullscreen overlay → hasOverlay becomes true
    act(() => {
      getHandles().overlay.showOverlay(() => <div data-testid="fullscreen">fs</div>, {}, { mode: 'fullscreen' });
    });

    // Request panel mode — should coerce to corner
    act(() => {
      getHandles().pip.show(MockCameraOverlay, {}, { mode: 'panel', target: 'main-content', timeout: 30 });
    });

    // Corner DOM present, panel DOM absent
    expect(document.querySelector('.pip-container')).toBeTruthy();
    expect(document.querySelector('.pip-panel')).toBeFalsy();
    expect(screen.getByTestId('camera-overlay')).toBeTruthy();
  });

  it('renders panel mode when no fullscreen overlay is active (regression)', () => {
    const getHandles = setup();

    act(() => {
      getHandles().pip.show(MockCameraOverlay, {}, { mode: 'panel', target: 'main-content', timeout: 30 });
    });

    expect(document.querySelector('.pip-panel')).toBeTruthy();
    expect(document.querySelector('.pip-container')).toBeFalsy();
    expect(screen.getByTestId('camera-overlay')).toBeTruthy();
  });
});
