import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import { ScreenVolumeProvider } from './ScreenVolumeProvider.jsx';
import {
  useScreenVolume,
  useEffectiveVolume,
  getMasterVolume,
  getMasterMuted,
  getEffectiveMaster,
  subscribeMaster,
  _resetForTests,
} from '../../lib/volume/ScreenVolumeContext.js';

function Probe({ onValue }) {
  const v = useScreenVolume();
  React.useEffect(() => onValue(v), [v, onValue]);
  return null;
}

function EffectiveProbe({ local, onValue }) {
  const eff = useEffectiveVolume(local);
  React.useEffect(() => onValue(eff), [eff, onValue]);
  return null;
}

describe('ScreenVolumeProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
    _resetForTests();
  });

  afterEach(() => {
    window.localStorage.clear();
    _resetForTests();
  });

  describe('initial state', () => {
    it('uses defaultMaster when no localStorage', () => {
      const onValue = vi.fn();
      render(
        <ScreenVolumeProvider defaultMaster={0.5}>
          <Probe onValue={onValue} />
        </ScreenVolumeProvider>
      );
      const last = onValue.mock.calls.at(-1)[0];
      expect(last.master).toBe(0.5);
      expect(last.muted).toBe(false);
    });

    it('reads from localStorage when present', () => {
      window.localStorage.setItem('screen-volume', JSON.stringify({ master: 0.3, muted: false }));
      const onValue = vi.fn();
      render(
        <ScreenVolumeProvider defaultMaster={0.5}>
          <Probe onValue={onValue} />
        </ScreenVolumeProvider>
      );
      const last = onValue.mock.calls.at(-1)[0];
      expect(last.master).toBe(0.3);
    });

    it('falls back to defaultMaster on malformed JSON', () => {
      window.localStorage.setItem('screen-volume', 'not-json{');
      const onValue = vi.fn();
      render(
        <ScreenVolumeProvider defaultMaster={0.5}>
          <Probe onValue={onValue} />
        </ScreenVolumeProvider>
      );
      const last = onValue.mock.calls.at(-1)[0];
      expect(last.master).toBe(0.5);
    });

    it('persists to per-keyboard storageKey', () => {
      window.localStorage.setItem(
        'screen-volume-office',
        JSON.stringify({ master: 0.8, muted: false })
      );
      const onValue = vi.fn();
      render(
        <ScreenVolumeProvider storageKey="screen-volume-office" defaultMaster={0.5}>
          <Probe onValue={onValue} />
        </ScreenVolumeProvider>
      );
      expect(onValue.mock.calls.at(-1)[0].master).toBe(0.8);
    });
  });

  describe('setMaster', () => {
    it('clamps values above 1', () => {
      let api;
      const onValue = vi.fn((v) => { api = v; });
      render(
        <ScreenVolumeProvider defaultMaster={0.5}>
          <Probe onValue={onValue} />
        </ScreenVolumeProvider>
      );
      act(() => api.setMaster(2));
      expect(onValue.mock.calls.at(-1)[0].master).toBe(1);
    });

    it('clamps values below 0', () => {
      let api;
      const onValue = vi.fn((v) => { api = v; });
      render(
        <ScreenVolumeProvider defaultMaster={0.5}>
          <Probe onValue={onValue} />
        </ScreenVolumeProvider>
      );
      act(() => api.setMaster(-0.5));
      expect(onValue.mock.calls.at(-1)[0].master).toBe(0);
    });

    it('persists value to localStorage', () => {
      let api;
      const onValue = vi.fn((v) => { api = v; });
      render(
        <ScreenVolumeProvider storageKey="test-key" defaultMaster={0.5}>
          <Probe onValue={onValue} />
        </ScreenVolumeProvider>
      );
      act(() => api.setMaster(0.4));
      const stored = JSON.parse(window.localStorage.getItem('test-key'));
      expect(stored.master).toBe(0.4);
    });
  });

  describe('step', () => {
    it('adds delta and clamps to [0,1]', () => {
      let api;
      const onValue = vi.fn((v) => { api = v; });
      render(
        <ScreenVolumeProvider defaultMaster={0.5}>
          <Probe onValue={onValue} />
        </ScreenVolumeProvider>
      );
      act(() => api.step(+0.1));
      expect(onValue.mock.calls.at(-1)[0].master).toBeCloseTo(0.6);
      act(() => api.step(+0.6));
      expect(onValue.mock.calls.at(-1)[0].master).toBe(1);
    });

    it('clamps at 0 from below', () => {
      let api;
      const onValue = vi.fn((v) => { api = v; });
      render(
        <ScreenVolumeProvider defaultMaster={0.0}>
          <Probe onValue={onValue} />
        </ScreenVolumeProvider>
      );
      act(() => api.step(-0.1));
      expect(onValue.mock.calls.at(-1)[0].master).toBe(0);
    });

    it('while muted, applies step on top of preMute (vol-up unmutes and increments)', () => {
      let api;
      const onValue = vi.fn((v) => { api = v; });
      render(
        <ScreenVolumeProvider defaultMaster={0.5}>
          <Probe onValue={onValue} />
        </ScreenVolumeProvider>
      );
      act(() => api.toggleMute());      // master=0 (muted), preMute=0.5
      expect(onValue.mock.calls.at(-1)[0].master).toBe(0);
      act(() => api.step(+0.1));        // expected: master = 0.5 + 0.1 = 0.6
      expect(onValue.mock.calls.at(-1)[0].master).toBeCloseTo(0.6);
      expect(onValue.mock.calls.at(-1)[0].muted).toBe(false);
    });

    it('while muted, vol-down also operates on preMute', () => {
      let api;
      const onValue = vi.fn((v) => { api = v; });
      render(
        <ScreenVolumeProvider defaultMaster={0.5}>
          <Probe onValue={onValue} />
        </ScreenVolumeProvider>
      );
      act(() => api.toggleMute());      // muted, preMute=0.5
      act(() => api.step(-0.1));        // expected: master = 0.5 - 0.1 = 0.4
      expect(onValue.mock.calls.at(-1)[0].master).toBeCloseTo(0.4);
    });
  });

  describe('toggleMute', () => {
    it('mutes from non-zero master to 0; remembers preMute', () => {
      let api;
      const onValue = vi.fn((v) => { api = v; });
      render(
        <ScreenVolumeProvider defaultMaster={0.7}>
          <Probe onValue={onValue} />
        </ScreenVolumeProvider>
      );
      act(() => api.toggleMute());
      expect(onValue.mock.calls.at(-1)[0].master).toBe(0);
      expect(onValue.mock.calls.at(-1)[0].muted).toBe(true);
    });

    it('unmutes by restoring preMute', () => {
      let api;
      const onValue = vi.fn((v) => { api = v; });
      render(
        <ScreenVolumeProvider defaultMaster={0.7}>
          <Probe onValue={onValue} />
        </ScreenVolumeProvider>
      );
      act(() => api.toggleMute());      // mute (master=0, preMute=0.7)
      act(() => api.toggleMute());      // unmute → 0.7
      expect(onValue.mock.calls.at(-1)[0].master).toBe(0.7);
      expect(onValue.mock.calls.at(-1)[0].muted).toBe(false);
    });

    it('preMute tracks the latest non-zero master', () => {
      let api;
      const onValue = vi.fn((v) => { api = v; });
      render(
        <ScreenVolumeProvider defaultMaster={0.7}>
          <Probe onValue={onValue} />
        </ScreenVolumeProvider>
      );
      act(() => api.setMaster(0.3));    // master=0.3, preMute=0.3
      act(() => api.toggleMute());       // muted, preMute should be 0.3
      act(() => api.toggleMute());       // unmute → 0.3
      expect(onValue.mock.calls.at(-1)[0].master).toBe(0.3);
    });
  });

  describe('useEffectiveVolume', () => {
    it('returns master × local', () => {
      let api;
      const onApi = vi.fn((v) => { api = v; });
      const onEff = vi.fn();
      render(
        <ScreenVolumeProvider defaultMaster={0.5}>
          <Probe onValue={onApi} />
          <EffectiveProbe local={0.8} onValue={onEff} />
        </ScreenVolumeProvider>
      );
      expect(onEff.mock.calls.at(-1)[0]).toBeCloseTo(0.4); // 0.5 * 0.8
      act(() => api.setMaster(1));
      expect(onEff.mock.calls.at(-1)[0]).toBeCloseTo(0.8);
    });

    it('returns local × 1 when no provider mounted (default master = 1)', () => {
      const onEff = vi.fn();
      render(<EffectiveProbe local={0.6} onValue={onEff} />);
      expect(onEff.mock.calls.at(-1)[0]).toBeCloseTo(0.6);
    });
  });

  describe('module-level accessors', () => {
    it('getMasterVolume reflects latest state synchronously after render commit', async () => {
      let api;
      const onValue = vi.fn((v) => { api = v; });
      render(
        <ScreenVolumeProvider defaultMaster={0.5}>
          <Probe onValue={onValue} />
        </ScreenVolumeProvider>
      );
      // After mount, the publish effect has run.
      expect(getMasterVolume()).toBe(0.5);
      act(() => api.setMaster(0.3));
      expect(getMasterVolume()).toBe(0.3);
    });

    it('getMasterMuted reflects mute state', () => {
      let api;
      const onValue = vi.fn((v) => { api = v; });
      render(
        <ScreenVolumeProvider defaultMaster={0.5}>
          <Probe onValue={onValue} />
        </ScreenVolumeProvider>
      );
      expect(getMasterMuted()).toBe(false);
      act(() => api.toggleMute());
      expect(getMasterMuted()).toBe(true);
    });

    it('subscribeMaster is called on every change; unsubscribe stops further calls', () => {
      let api;
      const onValue = vi.fn((v) => { api = v; });
      const sub = vi.fn();
      render(
        <ScreenVolumeProvider defaultMaster={0.5}>
          <Probe onValue={onValue} />
        </ScreenVolumeProvider>
      );
      const unsub = subscribeMaster(sub);
      act(() => api.setMaster(0.4));
      expect(sub).toHaveBeenCalledWith(0.4, false);
      unsub();
      act(() => api.setMaster(0.2));
      expect(sub).toHaveBeenCalledTimes(1);
    });
  });

  describe('outputCeiling', () => {
    it('exposes effectiveMaster = master × outputCeiling when ceiling < 1', () => {
      const onValue = vi.fn();
      render(
        <ScreenVolumeProvider defaultMaster={0.8} outputCeiling={0.25}>
          <Probe onValue={onValue} />
        </ScreenVolumeProvider>
      );
      const last = onValue.mock.calls.at(-1)[0];
      expect(last.master).toBeCloseTo(0.8, 5);
      expect(last.effectiveMaster).toBeCloseTo(0.2, 5); // 0.8 × 0.25
    });

    it('defaults effectiveMaster = master when outputCeiling is omitted', () => {
      const onValue = vi.fn();
      render(
        <ScreenVolumeProvider defaultMaster={0.5}>
          <Probe onValue={onValue} />
        </ScreenVolumeProvider>
      );
      const last = onValue.mock.calls.at(-1)[0];
      expect(last.master).toBeCloseTo(0.5, 5);
      expect(last.effectiveMaster).toBeCloseTo(0.5, 5);
    });

    it('mute always yields effectiveMaster = 0 regardless of ceiling', () => {
      let api;
      const onValue = vi.fn((v) => { api = v; });
      render(
        <ScreenVolumeProvider defaultMaster={0.8} outputCeiling={0.25}>
          <Probe onValue={onValue} />
        </ScreenVolumeProvider>
      );
      act(() => api.toggleMute());
      const last = onValue.mock.calls.at(-1)[0];
      expect(last.master).toBe(0);
      expect(last.effectiveMaster).toBe(0);
    });

    it('mirrors effectiveMaster to module state for non-React consumers', () => {
      render(
        <ScreenVolumeProvider defaultMaster={0.6} outputCeiling={0.5}>
          <Probe onValue={() => {}} />
        </ScreenVolumeProvider>
      );
      // 0.6 × 0.5 = 0.3
      expect(getEffectiveMaster()).toBeCloseTo(0.3, 5);
    });

    it('clamps outputCeiling to [0,1] so effectiveMaster never exceeds master', () => {
      const onValue = vi.fn();
      render(
        <ScreenVolumeProvider defaultMaster={0.8} outputCeiling={1.5}>
          <Probe onValue={onValue} />
        </ScreenVolumeProvider>
      );
      const last = onValue.mock.calls.at(-1)[0];
      // ceiling > 1 is clamped to 1; effectiveMaster = master × 1 = master
      expect(last.master).toBeCloseTo(0.8, 5);
      expect(last.effectiveMaster).toBeCloseTo(0.8, 5);
    });
  });

  describe('curveExponent', () => {
    it('exposes effectiveMaster = master ** curveExponent when ceiling = 1', () => {
      const onValue = vi.fn();
      render(
        <ScreenVolumeProvider defaultMaster={0.5} curveExponent={2}>
          <Probe onValue={onValue} />
        </ScreenVolumeProvider>
      );
      const last = onValue.mock.calls.at(-1)[0];
      // 0.5 ** 2 = 0.25
      expect(last.effectiveMaster).toBeCloseTo(0.25, 5);
    });

    it('combines curve and ceiling: (master ** curve) × ceiling', () => {
      const onValue = vi.fn();
      render(
        <ScreenVolumeProvider defaultMaster={0.5} curveExponent={2} outputCeiling={0.5}>
          <Probe onValue={onValue} />
        </ScreenVolumeProvider>
      );
      const last = onValue.mock.calls.at(-1)[0];
      // (0.5 ** 2) × 0.5 = 0.25 × 0.5 = 0.125
      expect(last.effectiveMaster).toBeCloseTo(0.125, 5);
    });

    it('defaults to linear (curveExponent = 1) so effectiveMaster = master × ceiling', () => {
      const onValue = vi.fn();
      render(
        <ScreenVolumeProvider defaultMaster={0.5} outputCeiling={0.5}>
          <Probe onValue={onValue} />
        </ScreenVolumeProvider>
      );
      const last = onValue.mock.calls.at(-1)[0];
      // 0.5 × 0.5 = 0.25, no curve
      expect(last.effectiveMaster).toBeCloseTo(0.25, 5);
    });

    it('preserves master = 0 → effectiveMaster = 0 (mute)', () => {
      let api;
      const onValue = vi.fn((v) => { api = v; });
      render(
        <ScreenVolumeProvider defaultMaster={0.5} curveExponent={3} outputCeiling={0.5}>
          <Probe onValue={onValue} />
        </ScreenVolumeProvider>
      );
      act(() => api.toggleMute());
      const last = onValue.mock.calls.at(-1)[0];
      expect(last.effectiveMaster).toBe(0);
    });
  });
});
