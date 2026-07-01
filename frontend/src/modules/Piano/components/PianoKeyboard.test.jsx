/**
 * PianoKeyboard — unit tests for the loop/hand-label overlay props added in
 * Producer phase 5.10 and 5.11.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PianoKeyboard } from './PianoKeyboard.jsx';

describe('PianoKeyboard — loopNotes prop (5.10)', () => {
  it('marks loop-driven notes distinctly from user-pressed notes', () => {
    const { container } = render(
      <PianoKeyboard
        activeNotes={new Map([[60, { velocity: 90 }]])}
        loopNotes={new Set([64])}
        startNote={60}
        endNote={67}
      />,
    );
    expect(container.querySelector('[data-note="64"]').classList.contains('loop')).toBe(true);
    expect(container.querySelector('[data-note="60"]').classList.contains('active')).toBe(true);
  });

  it('does not mark user-pressed notes as loop notes', () => {
    const { container } = render(
      <PianoKeyboard
        activeNotes={new Map([[60, { velocity: 90 }]])}
        loopNotes={new Set([64])}
        startNote={60}
        endNote={67}
      />,
    );
    expect(container.querySelector('[data-note="60"]').classList.contains('loop')).toBe(false);
  });

  it('renders normally without loopNotes prop', () => {
    const { container } = render(
      <PianoKeyboard
        activeNotes={new Map()}
        startNote={60}
        endNote={64}
      />,
    );
    expect(container.querySelector('.piano-keyboard')).toBeTruthy();
  });
});

describe('PianoKeyboard — handChordLabel prop (5.11)', () => {
  it('renders a hand-chord overlay label when provided', () => {
    const { container } = render(
      <PianoKeyboard
        activeNotes={new Map()}
        startNote={48}
        endNote={72}
        splitNote={60}
        handChordLabel="vi"
      />,
    );
    const label = container.querySelector('.piano-keyboard__hand-label');
    expect(label).toBeTruthy();
    expect(label.textContent).toContain('vi');
  });

  it('does not render hand-label when handChordLabel is not provided', () => {
    const { container } = render(
      <PianoKeyboard
        activeNotes={new Map()}
        startNote={48}
        endNote={72}
        splitNote={60}
      />,
    );
    expect(container.querySelector('.piano-keyboard__hand-label')).toBeNull();
  });
});
