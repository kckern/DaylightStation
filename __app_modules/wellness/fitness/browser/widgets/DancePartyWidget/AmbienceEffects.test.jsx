import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('lottie-web', () => ({ default: { loadAnimation: () => ({ destroy() {} }) } }));
vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: vi.fn().mockResolvedValue({}), DaylightMediaPath: (p) => p }));

const { resolveEffects, EffectsBoard, EffectOverlay, ArmedIndicator } = await import('./AmbienceEffects.jsx');

describe('resolveEffects', () => {
  it('keeps id+label entries and defaults motion/duration', () => {
    const r = resolveEffects([{ id: 'cat', label: 'Cat', lottie: 'x.json', motion: 'nope' }, { id: 'bad' }]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: 'cat', motion: 'center', duration: 4.5, screen: null });
  });
});

describe('EffectsBoard', () => {
  const effects = resolveEffects([{ id: 'lightning', label: 'Lightning' }, { id: 'cat', label: 'Cat' }]);
  it('fires now by default and closes', () => {
    const onFire = vi.fn(), onArm = vi.fn(), onClose = vi.fn();
    render(<EffectsBoard effects={effects} active={null} delaySeconds={15} onFire={onFire} onArm={onArm} onClose={onClose} />);
    fireEvent.click(screen.getByText('Lightning'));
    expect(onFire).toHaveBeenCalledWith(effects[0]);
    expect(onArm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
  it('arms instead when the delay is selected', () => {
    const onFire = vi.fn(), onArm = vi.fn();
    render(<EffectsBoard effects={effects} active={null} delaySeconds={15} onFire={onFire} onArm={onArm} onClose={() => {}} />);
    fireEvent.click(screen.getByText('15s'));
    fireEvent.click(screen.getByText('Cat'));
    expect(onArm).toHaveBeenCalledWith(effects[1]);
    expect(onFire).not.toHaveBeenCalled();
  });
});

describe('ArmedIndicator', () => {
  it('shows the countdown and cancels on tap', () => {
    const onCancel = vi.fn();
    render(<ArmedIndicator armed={{ effect: { label: 'Ghost' }, fireAt: 0 }} remainingS={12} onCancel={onCancel} />);
    fireEvent.click(screen.getByText(/Ghost · 12s/));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('EffectOverlay', () => {
  it('renders a flash, confetti, and a five-sprite flock', () => {
    const [flash, confetti, flock] = resolveEffects([
      { id: 'l', label: 'L', screen: 'flash' },
      { id: 'h', label: 'H', screen: 'confetti' },
      { id: 'b', label: 'B', lottie: 'bat.json', motion: 'flock' },
    ]);
    const { container, rerender } = render(<EffectOverlay effect={flash} />);
    expect(container.querySelector('.amb-fx-flash')).toBeTruthy();
    rerender(<EffectOverlay effect={confetti} />);
    expect(container.querySelectorAll('.amb-fx-confetti span').length).toBeGreaterThan(20);
    rerender(<EffectOverlay effect={flock} />);
    expect(container.querySelectorAll('.amb-fx-flock')).toHaveLength(5);
  });
});

describe('useAmbienceEffects — arming', () => {
  it('fires an armed effect after the delay, and cancel stops it', async () => {
    vi.useFakeTimers();
    const { renderHook, act } = await import('@testing-library/react');
    const { useAmbienceEffects: useFx } = await import('./AmbienceEffects.jsx');
    const effects = resolveEffects([{ id: 'ghost', label: 'Ghost' }]);
    const { result } = renderHook(() => useFx({ ambienceId: 'halloween', effects, musicRef: { current: null } }));
    act(() => result.current.arm(effects[0], 15000));
    expect(result.current.armed.effect.id).toBe('ghost');
    act(() => { vi.advanceTimersByTime(14000); });
    expect(result.current.active).toBeNull();
    act(() => { vi.advanceTimersByTime(1100); });
    expect(result.current.active?.id).toBe('ghost');
    expect(result.current.armed).toBeNull();
    act(() => { vi.advanceTimersByTime(10000); });
    act(() => result.current.arm(effects[0], 15000));
    act(() => result.current.cancelArm());
    act(() => { vi.advanceTimersByTime(20000); });
    expect(result.current.active).toBeNull();
    vi.useRealTimers();
  });
});
