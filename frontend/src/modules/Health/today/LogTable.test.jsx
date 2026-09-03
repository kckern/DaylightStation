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

const emptyByBucket = new Map([
  ['morning', []], ['afternoon', []], ['evening', []], ['night', []],
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

  describe('permanent chrome (Task 3.2)', () => {
    it('renders all bucket headings and add rows during a true cold start (coldLoading, no rows anywhere)', () => {
      render(<LogTable byBucket={emptyByBucket} sessions={[]} coldLoading
        onAddTo={() => {}} onRowTap={() => {}} />, { wrapper });
      expect(screen.getByText('Breakfast')).toBeTruthy();
      expect(screen.getByText('Lunch')).toBeTruthy();
      expect(screen.getByText('Dinner')).toBeTruthy();
      expect(screen.getByText('Snacks')).toBeTruthy();
      // Structure is present alongside the shimmer, not instead of it.
      expect(screen.getAllByText(/Add food/)).toHaveLength(BUCKETS.length);
      expect(screen.getAllByLabelText(/^Loading /).length).toBeGreaterThan(0);
    });

    it('does NOT show a shimmer for a bucket that already has cached rows, even while coldLoading is (incorrectly) passed true', () => {
      render(<LogTable byBucket={byBucket} sessions={[]} coldLoading
        onAddTo={() => {}} onRowTap={() => {}} />, { wrapper });
      // Breakfast has a row -> no shimmer there, and the row itself renders.
      expect(screen.getByText('Eggs')).toBeTruthy();
      expect(screen.queryByLabelText(/loading breakfast/i)).toBeNull();
      // The genuinely empty buckets DO shimmer.
      expect(screen.getByLabelText(/loading lunch/i)).toBeTruthy();
    });

    it('shows no shimmer anywhere when coldLoading is false, even with empty buckets (background revalidation)', () => {
      render(<LogTable byBucket={emptyByBucket} sessions={[]} coldLoading={false}
        onAddTo={() => {}} onRowTap={() => {}} />, { wrapper });
      expect(screen.queryByLabelText(/^Loading /)).toBeNull();
    });

    it('the Exercise header renders with zero sessions once budget data exists (exerciseAvailable)', () => {
      render(<LogTable byBucket={byBucket} sessions={[]} exerciseAvailable
        onAddTo={() => {}} onRowTap={() => {}} />, { wrapper });
      expect(screen.getByText('Exercise')).toBeTruthy();
    });

    it('the Exercise header is absent before budget data has ever loaded (exerciseAvailable false, no sessions)', () => {
      render(<LogTable byBucket={byBucket} sessions={[]}
        onAddTo={() => {}} onRowTap={() => {}} />, { wrapper });
      expect(screen.queryByText('Exercise')).toBeNull();
    });

    it('shows an "Analyzing…" placeholder in the targeted bucket only, with aria-busy', () => {
      render(<LogTable byBucket={byBucket} sessions={[]} capturePendingBucket="afternoon"
        onAddTo={() => {}} onRowTap={() => {}} />, { wrapper });
      const placeholder = screen.getByText('Analyzing…');
      expect(placeholder.closest('[aria-busy="true"]')).toBeTruthy();
      // It sits under Lunch (afternoon), not Breakfast (morning).
      const lunchSection = screen.getByText('Lunch').closest('section');
      expect(lunchSection.contains(placeholder)).toBe(true);
      const breakfastSection = screen.getByText('Breakfast').closest('section');
      expect(breakfastSection.contains(placeholder)).toBe(false);
    });

    it('shows no placeholder in any bucket when capturePendingBucket is null', () => {
      render(<LogTable byBucket={byBucket} sessions={[]}
        onAddTo={() => {}} onRowTap={() => {}} />, { wrapper });
      expect(screen.queryByText('Analyzing…')).toBeNull();
    });
  });

  describe('grouped rows', () => {
    const groupBucket = new Map([
      ['morning', [
        { uuid: 'g1', id: 'g1', kind: 'group', name: 'Smoothie', calories: 0 },
        { uuid: 'c1', id: 'c1', parentId: 'g1', name: 'Banana', calories: 105 },
        { uuid: 'c2', id: 'c2', parentId: 'g1', name: 'Protein powder', calories: 120 },
      ]],
      ['afternoon', []], ['evening', []], ['night', []],
      [null, []],
    ]);

    it('a collapsed group shows its rolled-up kcal while its children are not rendered', () => {
      render(<LogTable byBucket={groupBucket} sessions={[]} onAddTo={() => {}} onRowTap={() => {}} />, { wrapper });
      expect(screen.getByText('Smoothie')).toBeTruthy();
      // Rollup (105 + 120), not the group row's own (zero) calories.
      expect(screen.getByText('225')).toBeTruthy();
      expect(screen.queryByText('Banana')).toBeNull();
      expect(screen.queryByText('Protein powder')).toBeNull();
      const expandBtn = screen.getByRole('button', { name: /expand smoothie/i });
      expect(expandBtn.getAttribute('aria-expanded')).toBe('false');
    });

    it('expanding the group reveals its children indented, without changing the rollup', () => {
      render(<LogTable byBucket={groupBucket} sessions={[]} onAddTo={() => {}} onRowTap={() => {}} />, { wrapper });
      fireEvent.click(screen.getByRole('button', { name: /expand smoothie/i }));
      expect(screen.getByText('Banana')).toBeTruthy();
      expect(screen.getByText('Protein powder')).toBeTruthy();
      expect(screen.getByText('225')).toBeTruthy();
      const collapseBtn = screen.getByRole('button', { name: /collapse smoothie/i });
      expect(collapseBtn.getAttribute('aria-expanded')).toBe('true');
    });

    it('tapping the group row itself (not the chevron) fires onRowTap like an item row', () => {
      const onRowTap = vi.fn();
      render(<LogTable byBucket={groupBucket} sessions={[]} onAddTo={() => {}} onRowTap={onRowTap} />, { wrapper });
      fireEvent.click(screen.getByText('Smoothie'));
      expect(onRowTap).toHaveBeenCalledWith(expect.objectContaining({ id: 'g1' }));
    });

    it('bucket kcal total counts each gram once (group contributes zero, children carry the values)', () => {
      render(<LogTable byBucket={groupBucket} sessions={[]} onAddTo={() => {}} onRowTap={() => {}} />, { wrapper });
      // 0 (group) + 105 + 120 = 225, not 450 (double-counted) or 0.
      expect(screen.getByText('225 kcal')).toBeTruthy();
    });

    // Regression: LogTable must render attached children regardless of the
    // parent row's `kind` — groupRows() attaches a child whenever its
    // parentId resolves to ANY row, not only a kind:'group' one, so gating
    // the render on kind:'group' silently dropped the child from the
    // screen even though groupRows() had already attached it correctly.
    it('renders a child even when its parent row is NOT kind:"group" (e.g. kind:"item" or no kind at all)', () => {
      const plainParentBucket = new Map([
        ['morning', [
          { uuid: 'p1', id: 'p1', kind: 'item', name: 'Plate', calories: 0 },
          { uuid: 's1', id: 's1', parentId: 'p1', name: 'Side item', calories: 200 },
        ]],
        ['afternoon', []], ['evening', []], ['night', []],
        [null, []],
      ]);
      render(<LogTable byBucket={plainParentBucket} sessions={[]} onAddTo={() => {}} onRowTap={() => {}} />, { wrapper });
      expect(screen.getByText('Plate')).toBeTruthy();
      // Rolled-up kcal shown collapsed; the child itself appears once expanded.
      expect(screen.getByText('200')).toBeTruthy();
      const expandBtn = screen.getByRole('button', { name: /expand plate/i });
      fireEvent.click(expandBtn);
      expect(screen.getByText('Side item')).toBeTruthy();
    });

    it('a group row with settled:false still shows the unsettled cue and confirm button', () => {
      const unsettledGroupBucket = new Map([
        ['morning', [
          { uuid: 'g1', id: 'g1', kind: 'group', name: 'Smoothie', calories: 0, settled: false },
          { uuid: 'c1', id: 'c1', parentId: 'g1', name: 'Banana', calories: 105 },
        ]],
        ['afternoon', []], ['evening', []], ['night', []],
        [null, []],
      ]);
      render(<LogTable byBucket={unsettledGroupBucket} sessions={[]} onAddTo={() => {}} onRowTap={() => {}} />, { wrapper });
      expect(screen.getByText(/unconfirmed/i)).toBeTruthy();
      expect(screen.getByRole('button', { name: /confirm entry/i })).toBeTruthy();
    });
  });
});
