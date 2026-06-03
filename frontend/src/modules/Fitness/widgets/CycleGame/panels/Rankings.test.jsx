import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Rankings from './Rankings.jsx';

describe('Rankings panel', () => {
  it('renders one row per rider sorted by distance, leader first', () => {
    render(<Rankings
      riderIds={['a', 'b']}
      riders={{ a: { displayName: 'Ann', cumulativeDistanceM: 100 }, b: { displayName: 'Bob', cumulativeDistanceM: 300 } }}
      riderLive={{ a: {}, b: {} }}
    />);
    const rows = screen.getAllByTestId('roster-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Bob'); // Bob (300m) ranked first
  });
});
