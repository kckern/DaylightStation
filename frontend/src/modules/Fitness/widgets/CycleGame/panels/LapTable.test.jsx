import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LapTable from './LapTable.jsx';

describe('LapTable', () => {
  it('renders one row per completed lap and a column per rider', () => {
    render(<LapTable
      riderIds={['a', 'b']}
      riders={{ a: { displayName: 'Ann' }, b: { displayName: 'Bob' } }}
      lapSplits={{ a: [30, 65], b: [32] }}
    />);
    expect(screen.getByText('Lap 1')).toBeInTheDocument();
    expect(screen.getByText('Lap 2')).toBeInTheDocument();
    expect(screen.getByText('Ann')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });
  it('shows the per-lap delta, not cumulative time', () => {
    render(<LapTable riderIds={['a']} riders={{ a: { displayName: 'Ann' } }} lapSplits={{ a: [30, 65] }} />);
    expect(screen.getByText('0:30')).toBeInTheDocument(); // lap 1 = 30 - 0
    expect(screen.getByText('0:35')).toBeInTheDocument(); // lap 2 = 65 - 30
  });
});
