import { describe, it, expect } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import NoteHighlightLayer from './NoteHighlightLayer.jsx';

// Fake OSMD notehead <g> elements (only classList + style are touched).
const mkEl = () => document.createElementNS('http://www.w3.org/2000/svg', 'g');
const stepOf = (rhEl, lhEl) => ({
  notes: [
    { midi: 60, staff: 0, el: rhEl },
    { midi: 48, staff: 1, el: lhEl },
  ],
});

describe('NoteHighlightLayer', () => {
  it('lights each active-staff notehead in place and glows the struck ones', () => {
    const rh = mkEl();
    const lh = mkEl();
    render(
      <NoteHighlightLayer step={stepOf(rh, lh)} activeParts={{ 0: true, 1: true }} struck={new Set([60])} accent="#2ec46f" />,
    );
    expect(rh.classList.contains('piano-note-lit')).toBe(true);
    expect(rh.classList.contains('piano-note-hit')).toBe(true); // 60 struck
    expect(rh.style.getPropertyValue('--nh-color')).toBe('#2ec46f');
    expect(lh.classList.contains('piano-note-lit')).toBe(true);
    expect(lh.classList.contains('piano-note-hit')).toBe(false); // 48 not yet struck
  });

  it('leaves deactivated-staff noteheads untouched', () => {
    const rh = mkEl();
    const lh = mkEl();
    render(
      <NoteHighlightLayer step={stepOf(rh, lh)} activeParts={{ 0: true, 1: false }} struck={new Set()} accent="#2ec46f" />,
    );
    expect(rh.classList.contains('piano-note-lit')).toBe(true);
    expect(lh.classList.contains('piano-note-lit')).toBe(false);
  });

  it('reverts the tint on unmount', () => {
    const rh = mkEl();
    const lh = mkEl();
    const { unmount } = render(
      <NoteHighlightLayer step={stepOf(rh, lh)} activeParts={{ 0: true, 1: true }} struck={new Set()} accent="#2ec46f" />,
    );
    unmount();
    expect(rh.classList.contains('piano-note-lit')).toBe(false);
    expect(rh.style.getPropertyValue('--nh-color')).toBe('');
    expect(lh.classList.contains('piano-note-lit')).toBe(false);
  });

  it('reverts the previous set when the step advances', () => {
    const rh1 = mkEl();
    const rh2 = mkEl();
    const { rerender } = render(
      <NoteHighlightLayer step={{ notes: [{ midi: 60, staff: 0, el: rh1 }] }} activeParts={{ 0: true }} struck={new Set()} accent="#2ec46f" />,
    );
    expect(rh1.classList.contains('piano-note-lit')).toBe(true);
    rerender(
      <NoteHighlightLayer step={{ notes: [{ midi: 62, staff: 0, el: rh2 }] }} activeParts={{ 0: true }} struck={new Set()} accent="#2ec46f" />,
    );
    expect(rh1.classList.contains('piano-note-lit')).toBe(false); // old note reverted
    expect(rh2.classList.contains('piano-note-lit')).toBe(true); // new note lit
    cleanup();
  });
});
