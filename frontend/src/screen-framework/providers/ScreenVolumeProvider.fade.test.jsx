// Sleep-timer fade (RQ-STEER-12): a transient multiplier on the effective
// output that never touches the user's master, its persistence or the toast.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import { ScreenVolumeProvider } from './ScreenVolumeProvider.jsx';
import { useScreenVolume, _resetForTests } from '../../lib/volume/ScreenVolumeContext.js';

function Probe({ onValue }) {
  const v = useScreenVolume();
  React.useEffect(() => onValue(v), [v, onValue]);
  return null;
}

describe('ScreenVolumeProvider fade', () => {
  beforeEach(() => { window.localStorage.clear(); _resetForTests(); });

  it('scales effectiveMaster without changing master or persisting', () => {
    const onValue = vi.fn();
    render(<ScreenVolumeProvider defaultMaster={0.8}><Probe onValue={onValue} /></ScreenVolumeProvider>);
    const first = onValue.mock.calls.at(-1)[0];
    expect(first.fade).toBe(1);
    act(() => first.setFade(0.25));
    const faded = onValue.mock.calls.at(-1)[0];
    expect(faded.master).toBe(0.8);
    expect(faded.effectiveMaster).toBeCloseTo(0.2);
    expect(JSON.parse(window.localStorage.getItem('screen-volume')).master).toBe(0.8);
    act(() => faded.setFade(1));
    expect(onValue.mock.calls.at(-1)[0].effectiveMaster).toBeCloseTo(0.8);
  });

  it('fades even a fixed (hardware-volume) screen and clamps the multiplier', () => {
    const onValue = vi.fn();
    render(<ScreenVolumeProvider defaultMaster={1} fixed><Probe onValue={onValue} /></ScreenVolumeProvider>);
    act(() => onValue.mock.calls.at(-1)[0].setFade(-3));
    expect(onValue.mock.calls.at(-1)[0].effectiveMaster).toBe(0);
    act(() => onValue.mock.calls.at(-1)[0].setFade(5));
    expect(onValue.mock.calls.at(-1)[0].effectiveMaster).toBe(1);
  });
});
