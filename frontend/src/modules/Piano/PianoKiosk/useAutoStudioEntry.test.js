import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAutoStudioEntry } from './useAutoStudioEntry.js';

const CFG = { enabled: true, minNotes: 8, minSpanSeconds: 3, windowSeconds: 10 };
const note = (startTime) => ({ note: 60, velocity: 90, startTime, endTime: null });
const playing = (base = 0) => [0, 500, 1000, 1500, 2000, 2500, 3000, 3500].map((t) => note(base + t));

const base = {
  pathname: '/piano',
  basePath: '/piano',
  noteHistory: [],
  autoStudio: CFG,
  inactivityMinutes: 10,
  consumeIdleReturn: () => false,
};

function mount(props) {
  return renderHook((p) => useAutoStudioEntry(p), { initialProps: { ...base, ...props } });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useAutoStudioEntry', () => {
  it('fires onEnter once when sustained playing happens on the menu', () => {
    const onEnter = vi.fn();
    const { rerender } = mount({ onEnter });
    rerender({ ...base, onEnter, noteHistory: playing() });
    expect(onEnter).toHaveBeenCalledTimes(1);
    // More notes while still on the menu must not re-fire immediately
    rerender({ ...base, onEnter, noteHistory: [...playing(), note(4000)] });
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it('does not fire off the menu route', () => {
    const onEnter = vi.fn();
    const { rerender } = mount({ onEnter, pathname: '/piano/videos' });
    rerender({ ...base, onEnter, pathname: '/piano/videos', noteHistory: playing() });
    expect(onEnter).not.toHaveBeenCalled();
  });

  it('does not fire when disabled', () => {
    const onEnter = vi.fn();
    const off = { ...CFG, enabled: false };
    const { rerender } = mount({ onEnter, autoStudio: off });
    rerender({ ...base, onEnter, autoStudio: off, noteHistory: playing() });
    expect(onEnter).not.toHaveBeenCalled();
  });

  it('manual Studio→menu exit disarms; playing again does not re-fire', () => {
    const onEnter = vi.fn();
    const { rerender } = mount({ onEnter });
    rerender({ ...base, onEnter, pathname: '/piano/studio' });        // (auto or manual) entry
    rerender({ ...base, onEnter, pathname: '/piano' });               // manual exit → disarm
    rerender({ ...base, onEnter, noteHistory: playing(10_000) });
    expect(onEnter).not.toHaveBeenCalled();
  });

  it('idle-flagged Studio→menu return does NOT disarm', () => {
    const onEnter = vi.fn();
    let idleFlag = false;
    const consumeIdleReturn = () => { const v = idleFlag; idleFlag = false; return v; };
    const props = { ...base, onEnter, consumeIdleReturn };
    const { rerender } = renderHook((p) => useAutoStudioEntry(p), { initialProps: props });
    rerender({ ...props, pathname: '/piano/studio' });
    idleFlag = true;
    rerender({ ...props, pathname: '/piano' });                       // idle return → stays armed
    rerender({ ...props, noteHistory: playing(10_000) });
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it('re-arms after inactivityMinutes of quiet', () => {
    const onEnter = vi.fn();
    const { rerender } = mount({ onEnter });
    rerender({ ...base, onEnter, pathname: '/piano/studio' });
    rerender({ ...base, onEnter, pathname: '/piano' });               // disarmed
    vi.advanceTimersByTime(10 * 60_000 + 1000);                       // quiet for inactivityMinutes
    rerender({ ...base, onEnter, noteHistory: playing(20_000) });
    expect(onEnter).toHaveBeenCalledTimes(1);
  });
});
