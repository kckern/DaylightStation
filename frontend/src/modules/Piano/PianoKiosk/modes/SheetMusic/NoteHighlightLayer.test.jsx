import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import NoteHighlightLayer from './NoteHighlightLayer.jsx';

const step = { notes: [{ midi: 60, staff: 0, x: 10, top: 5, bottom: 20, width: 8 }, { midi: 48, staff: 1, x: 10, top: 40, bottom: 55, width: 8 }] };

describe('NoteHighlightLayer', () => {
  it('renders one chip per active-staff note with the right state', () => {
    const { container } = render(
      <NoteHighlightLayer step={step} activeParts={{ 0: true, 1: true }} struck={new Set([60])} scale={1} accent="#2ec46f" />,
    );
    const chips = container.querySelectorAll('.piano-score-note');
    expect(chips.length).toBe(2);
    expect(container.querySelector('.piano-score-note--hit')).toBeTruthy();    // 60 struck
    expect(container.querySelector('.piano-score-note--target')).toBeTruthy(); // 48 not yet
  });

  it('omits notes on deactivated staves', () => {
    const { container } = render(
      <NoteHighlightLayer step={step} activeParts={{ 0: true, 1: false }} struck={new Set()} scale={1} accent="#2ec46f" />,
    );
    expect(container.querySelectorAll('.piano-score-note').length).toBe(1);
  });

  it('positions each chip via a compositor-path transform (translate3d), not left/top', () => {
    const { container } = render(
      <NoteHighlightLayer step={step} activeParts={{ 0: true, 1: true }} struck={new Set()} scale={1} accent="#2ec46f" />,
    );
    const chips = container.querySelectorAll('.piano-score-note');
    // Chip 0: x=10, width=8, scale=1 → translateX = 10 - 8/2 = 6; top = 5.
    expect(chips[0].style.transform).toBe('translate3d(6px, 5px, 0)');
    expect(chips[0].style.left).toBe(''); // no layout-invalidating left/top
    expect(chips[0].style.top).toBe('');
    // Chip 1: x=10, width=8 → translateX = 6; top = 40.
    expect(chips[1].style.transform).toBe('translate3d(6px, 40px, 0)');
  });
});
