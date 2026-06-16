import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderHook } from '@testing-library/react';
import {
  ScreenAmbientProvider,
  useScreenAmbient,
} from '../../../frontend/src/screen-framework/ambient/ScreenAmbientContext.jsx';

describe('useScreenAmbient', () => {
  it('returns the provided ambient config', () => {
    const ambient = { topic: 'ambient:office', curve: [{ lux: 0, dim: 0.9 }], defaultLux: 36 };
    const wrapper = ({ children }) => (
      <ScreenAmbientProvider value={ambient}>{children}</ScreenAmbientProvider>
    );
    const { result } = renderHook(() => useScreenAmbient(), { wrapper });
    expect(result.current).toEqual(ambient);
  });

  it('returns null when no value is provided', () => {
    const wrapper = ({ children }) => (
      <ScreenAmbientProvider value={undefined}>{children}</ScreenAmbientProvider>
    );
    const { result } = renderHook(() => useScreenAmbient(), { wrapper });
    expect(result.current).toBe(null);
  });

  it('returns null with no provider at all', () => {
    const { result } = renderHook(() => useScreenAmbient());
    expect(result.current).toBe(null);
  });
});
