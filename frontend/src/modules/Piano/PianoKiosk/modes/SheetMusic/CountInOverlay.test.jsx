import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import CountInOverlay from './CountInOverlay.jsx';

describe('CountInOverlay', () => {
  it('renders the current beat big and centered when active', () => {
    const { container } = render(<CountInOverlay active beat={3} />);
    const el = container.querySelector('.piano-score-countin');
    expect(el).toBeTruthy();
    expect(el).toHaveTextContent('3');
  });

  it('renders nothing when inactive', () => {
    const { container } = render(<CountInOverlay active={false} beat={2} />);
    expect(container.querySelector('.piano-score-countin')).toBeNull();
  });
});
