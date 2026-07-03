import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { TheoryPanel } from './TheoryPanel.jsx';

describe('TheoryPanel', () => {
  const notes = new Map([[60, {}], [64, {}], [67, {}]]);

  it.each(['row', 'column'])('renders circle, staff, and chord slots (%s layout)', (layout) => {
    const { container } = render(<TheoryPanel activeNotes={notes} layout={layout} />);
    expect(container.querySelector(`.theory-panel--${layout}`)).toBeTruthy();
    expect(container.querySelector('.theory-panel__circle .piano-circle-of-fifths')).toBeTruthy();
    expect(container.querySelector('.theory-panel__staff .chord-staff')).toBeTruthy();
    expect(container.querySelector('.theory-panel__chord .piano-chord-name')).toBeTruthy();
  });

  it('defaults to row layout', () => {
    const { container } = render(<TheoryPanel activeNotes={new Map()} />);
    expect(container.querySelector('.theory-panel--row')).toBeTruthy();
  });
});
