import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StudioTopPane } from './StudioTopPane.jsx';

const map = (entries) => new Map(entries);

describe('StudioTopPane', () => {
  it('renders the fixed-height pane shell with a centered content slot by default', () => {
    const { container } = render(<StudioTopPane activeNotes={map([])} />);
    const pane = container.querySelector('.piano-studio-toppane');
    expect(pane).toBeTruthy();
    // default alignment modifier present
    expect(pane.classList.contains('piano-studio-toppane--center')).toBe(true);
    // content slot exists and, with no children, holds the default grand staff
    const content = pane.querySelector('.piano-studio-toppane__content');
    expect(content).toBeTruthy();
    expect(content.querySelector('.current-chord-staff-wrapper')).toBeTruthy();
  });

  it('swaps in arbitrary content via the children slot (no default staff)', () => {
    const { container } = render(
      <StudioTopPane>
        <div data-testid="triptych-stub">triptych</div>
      </StudioTopPane>,
    );
    const content = container.querySelector('.piano-studio-toppane__content');
    expect(content.querySelector('[data-testid="triptych-stub"]')).toBeTruthy();
    // children replace the default staff — no auto staff when content is provided
    expect(content.querySelector('.current-chord-staff-wrapper')).toBeNull();
  });

  it('applies the stretch alignment modifier when requested', () => {
    const { container } = render(<StudioTopPane align="stretch" activeNotes={map([])} />);
    const pane = container.querySelector('.piano-studio-toppane');
    expect(pane.classList.contains('piano-studio-toppane--stretch')).toBe(true);
  });
});
