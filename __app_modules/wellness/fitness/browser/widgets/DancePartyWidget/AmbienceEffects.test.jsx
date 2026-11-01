import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('lottie-web', () => ({ default: { loadAnimation: () => ({ destroy() {} }) } }));
vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: vi.fn().mockResolvedValue({}), DaylightMediaPath: (p) => p }));

const { resolveEffects, EffectsBoard, EffectOverlay } = await import('./AmbienceEffects.jsx');

describe('resolveEffects', () => {
  it('keeps id+label entries and defaults motion/duration', () => {
    const r = resolveEffects([{ id: 'cat', label: 'Cat', lottie: 'x.json', motion: 'nope' }, { id: 'bad' }]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: 'cat', motion: 'center', duration: 4.5, screen: null });
  });
});

describe('EffectsBoard', () => {
  it('fires the pressed effect and disables buttons while one runs', () => {
    const effects = resolveEffects([{ id: 'lightning', label: 'Lightning' }, { id: 'cat', label: 'Cat' }]);
    const onFire = vi.fn();
    const { rerender } = render(<EffectsBoard effects={effects} active={null} onFire={onFire} onClose={() => {}} />);
    fireEvent.click(screen.getByText('Lightning'));
    expect(onFire).toHaveBeenCalledWith(effects[0]);
    rerender(<EffectsBoard effects={effects} active={effects[0]} onFire={onFire} onClose={() => {}} />);
    expect(screen.getByText('Cat').disabled).toBe(true);
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
