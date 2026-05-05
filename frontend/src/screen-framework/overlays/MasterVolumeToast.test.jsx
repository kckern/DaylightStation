import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import { ScreenVolumeProvider } from '../providers/ScreenVolumeProvider.jsx';
import { useScreenVolume, _resetForTests } from '../../lib/volume/ScreenVolumeContext.js';
import { MasterVolumeToast } from './MasterVolumeToast.jsx';

let api;
function ApiCapture() {
  const v = useScreenVolume();
  React.useEffect(() => { api = v; }, [v]);
  return null;
}

describe('MasterVolumeToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    _resetForTests();
    api = null;
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
    _resetForTests();
  });

  it('does not appear on initial mount', () => {
    const { queryByTestId } = render(
      <ScreenVolumeProvider defaultMaster={0.5}>
        <MasterVolumeToast />
        <ApiCapture />
      </ScreenVolumeProvider>
    );
    expect(queryByTestId('master-volume-toast')).toBeNull();
  });

  it('appears on master change and shows percent', () => {
    const { queryByTestId } = render(
      <ScreenVolumeProvider defaultMaster={0.5}>
        <MasterVolumeToast />
        <ApiCapture />
      </ScreenVolumeProvider>
    );
    act(() => api.setMaster(0.7));
    const toast = queryByTestId('master-volume-toast');
    expect(toast).toBeTruthy();
    expect(toast.textContent).toContain('70');
  });

  it('shows muted indicator when muted', () => {
    const { queryByTestId } = render(
      <ScreenVolumeProvider defaultMaster={0.5}>
        <MasterVolumeToast />
        <ApiCapture />
      </ScreenVolumeProvider>
    );
    act(() => api.toggleMute());
    const toast = queryByTestId('master-volume-toast');
    expect(toast).toBeTruthy();
    expect(toast.textContent).toContain('Muted');
  });

  it('hides after 1200ms', () => {
    const { queryByTestId } = render(
      <ScreenVolumeProvider defaultMaster={0.5}>
        <MasterVolumeToast />
        <ApiCapture />
      </ScreenVolumeProvider>
    );
    act(() => api.setMaster(0.7));
    expect(queryByTestId('master-volume-toast')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(1300); });
    expect(queryByTestId('master-volume-toast')).toBeNull();
  });

  it('rapid changes reset the timer', () => {
    const { queryByTestId } = render(
      <ScreenVolumeProvider defaultMaster={0.5}>
        <MasterVolumeToast />
        <ApiCapture />
      </ScreenVolumeProvider>
    );
    act(() => api.setMaster(0.6));
    act(() => { vi.advanceTimersByTime(800); });
    act(() => api.setMaster(0.7)); // resets timer
    act(() => { vi.advanceTimersByTime(800); }); // 1600ms total since first change but only 800ms since last
    expect(queryByTestId('master-volume-toast')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(500); });
    expect(queryByTestId('master-volume-toast')).toBeNull();
  });
});
