import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { LogTable } from './LogTable.jsx';
import { BUCKETS } from './mealBuckets.js';

const byBucket = new Map([
  ['morning', [{ uuid: '1', name: 'Eggs', calories: 140, amount: 2, unit: 'lg', color: 'green' }]],
  ['afternoon', []], ['evening', []], ['night', []],
  [null, []],
]);

const wrapper = ({ children }) => <MantineProvider>{children}</MantineProvider>;

describe('LogTable', () => {
  it('renders bucket labels, rows, and kcal subtotals', () => {
    render(<LogTable byBucket={byBucket} sessions={[]} onAddTo={() => {}} onRowTap={() => {}} />, { wrapper });
    expect(screen.getByText('Breakfast')).toBeTruthy();
    expect(screen.getByText('Eggs')).toBeTruthy();
    expect(screen.getByText('140 kcal')).toBeTruthy();
    expect(screen.getAllByText(/Add food/)).toHaveLength(BUCKETS.length);
  });

  it('hides UNGROUPED when empty, shows it when populated', () => {
    const { rerender } = render(<LogTable byBucket={byBucket} sessions={[]} onAddTo={() => {}} onRowTap={() => {}} />, { wrapper });
    expect(screen.queryByText('Ungrouped')).toBeNull();
    const withOrphan = new Map(byBucket);
    withOrphan.set(null, [{ uuid: '9', name: 'Mystery', calories: 100 }]);
    rerender(<MantineProvider><LogTable byBucket={withOrphan} sessions={[]} onAddTo={() => {}} onRowTap={() => {}} /></MantineProvider>);
    expect(screen.getByText('Ungrouped')).toBeTruthy();
  });

  it('renders exercise sessions read-only with credit', () => {
    render(<LogTable byBucket={byBucket}
      sessions={[{ type: 'cycling', duration_min: 42, calories: 320 }]}
      onAddTo={() => {}} onRowTap={() => {}} />, { wrapper });
    expect(screen.getByText('Exercise')).toBeTruthy();
    // Both the section subtotal ("+320 kcal") and the row credit ("+320") own
    // matching direct text nodes, so both legitimately match this pattern.
    expect(screen.getAllByText(/\+320/).length).toBeGreaterThan(0);
  });

  it('add and row taps fire with the right arguments', () => {
    const onAddTo = vi.fn(); const onRowTap = vi.fn();
    render(<LogTable byBucket={byBucket} sessions={[]} onAddTo={onAddTo} onRowTap={onRowTap} />, { wrapper });
    fireEvent.click(screen.getAllByText(/Add food/)[0]);
    expect(onAddTo).toHaveBeenCalledWith('morning');
    fireEvent.click(screen.getByText('Eggs'));
    expect(onRowTap).toHaveBeenCalledWith(expect.objectContaining({ uuid: '1' }));
  });
});
