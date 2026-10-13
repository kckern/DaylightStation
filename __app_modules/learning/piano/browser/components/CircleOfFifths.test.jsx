import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { CircleOfFifths } from './CircleOfFifths.jsx';

describe('CircleOfFifths', () => {
  it('renders 12 key bubbles', () => {
    const { container } = render(<CircleOfFifths pitchClasses={[]} />);
    expect(container.querySelectorAll('.cof-slot').length).toBe(12);
  });

  it('renders the diatonic degree ring + tonic marker for a detected key', () => {
    const { container } = render(<CircleOfFifths pitchClasses={[]} detectedKey="C" />);
    // Seven diatonic degree labels, incl. the diminished vii°.
    const degrees = [...container.querySelectorAll('.cof-degree')].map((n) => n.textContent);
    expect(degrees.length).toBe(7);
    expect(degrees).toContain('I');
    expect(degrees).toContain('V');
    expect(degrees).toContain('vii°');
    // Tonic marker present.
    expect(container.querySelector('.cof-tonic')).toBeTruthy();
  });

  it('tints diatonic bubbles by chord quality', () => {
    const { container } = render(<CircleOfFifths pitchClasses={[]} detectedKey="C" />);
    expect(container.querySelectorAll('.cof-slot.q-major').length).toBe(3);    // IV I V
    expect(container.querySelectorAll('.cof-slot.q-minor').length).toBe(3);    // ii vi iii
    expect(container.querySelectorAll('.cof-slot.q-diminished').length).toBe(1); // vii°
  });

  it('emphasises the played chord root and lights up sounding slots', () => {
    // Play a C major triad in the key of C: root C (pc 0) → is-root; C/E/G sounding.
    const { container } = render(
      <CircleOfFifths pitchClasses={[0, 4, 7]} detectedKey="C" rootPc={0} />,
    );
    expect(container.querySelectorAll('.cof-slot.is-root').length).toBe(1);
    expect(container.querySelectorAll('.cof-slot.is-active').length).toBe(3);
  });

  it('shows no degree ring / marker for an unknown key', () => {
    const { container } = render(<CircleOfFifths pitchClasses={[]} detectedKey={undefined} />);
    expect(container.querySelectorAll('.cof-degree').length).toBe(0);
    expect(container.querySelector('.cof-tonic')).toBeNull();
  });
});
