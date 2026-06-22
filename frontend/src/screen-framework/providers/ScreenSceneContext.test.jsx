// frontend/src/screen-framework/providers/ScreenSceneContext.test.jsx
import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/react';
import { ScreenSceneProvider, useScreenScene } from './ScreenSceneContext.jsx';

let api = null;
function Capture() { api = useScreenScene(); return null; }

describe('ScreenSceneContext', () => {
  it('defaults artSceneActive to false', () => {
    render(<ScreenSceneProvider><Capture /></ScreenSceneProvider>);
    expect(api.artSceneActive).toBe(false);
  });

  it('setArtSceneActive(true) flips the flag', () => {
    render(<ScreenSceneProvider><Capture /></ScreenSceneProvider>);
    act(() => api.setArtSceneActive(true));
    expect(api.artSceneActive).toBe(true);
  });

  it('provides a no-op default outside a provider', () => {
    render(<Capture />);
    expect(api.artSceneActive).toBe(false);
    expect(() => api.setArtSceneActive(true)).not.toThrow();
  });
});
