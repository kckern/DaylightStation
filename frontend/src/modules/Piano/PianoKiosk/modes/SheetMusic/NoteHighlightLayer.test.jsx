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
});
