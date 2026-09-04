import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { LogTable } from './LogTable.jsx';
import { MacroFooter } from './MacroFooter.jsx';
import { UNCOUNTED_STATUSES, sumCounted } from '@shared-contracts/nutrition/countedRows.mjs';

// Q1 (review): the day had THREE folds over the same rows — BudgetService's
// COUNTED one behind the equation and the macro bars, MacroFooter's unfiltered
// one, and the new per-meal subtotal's unfiltered one. Latent only because every
// live nutrilist row is `accepted` today. This file pins the two client folds to
// the shared contract the server folds with, using a day that contains one row
// of every uncounted status so a regression in either shows up as a NUMBER, not
// as a class name.
//
// The server side of the same invariant is pinned in BudgetService.test.mjs
// ("sums protein/carbs/fat ... over the SAME COUNTED fold as food"), and both
// import `shared/contracts/nutrition/countedRows.mjs`.

const wrapper = ({ children }) => <MantineProvider>{children}</MantineProvider>;

const COUNTS = [
  { uuid: 'a', name: 'Eggs', calories: 140, protein: 12, carbs: 1, fat: 10 },
  { uuid: 'b', name: 'Toast', calories: 90, protein: 3, carbs: 17, fat: 1, settled: false },
];
const DOES_NOT = UNCOUNTED_STATUSES.map((status, i) => ({
  uuid: `x${i}`, name: `Ghost ${status}`, status,
  calories: 1000, protein: 100, carbs: 100, fat: 100,
}));
const ROWS = [...COUNTS, ...DOES_NOT];

const byBucket = new Map([
  ['morning', ROWS], ['afternoon', []], ['evening', []], ['night', []], [null, []],
]);

describe('one fold for the whole day', () => {
  it('the shared contract is the arithmetic both components are measured against', () => {
    expect(Math.round(sumCounted(ROWS, 'calories'))).toBe(230);
    expect(Math.round(sumCounted(ROWS, 'protein'))).toBe(15);
  });

  it('the per-meal kcal subtotal drops every uncounted row', () => {
    render(<LogTable byBucket={byBucket} sessions={[]} onAddTo={() => {}} onRowTap={() => {}} />, { wrapper });
    expect(screen.getByText('230 kcal')).toBeTruthy();
  });

  it('the per-meal macro subtotal drops every uncounted row', () => {
    render(<LogTable byBucket={byBucket} sessions={[]} onAddTo={() => {}} onRowTap={() => {}} />, { wrapper });
    expect(screen.getByText('P 15 · C 18 · F 11')).toBeTruthy();
  });

  it('the footer macro totals drop every uncounted row', () => {
    render(<MacroFooter items={ROWS} />, { wrapper });
    expect(screen.getByText('P 15g · C 18g · F 11g')).toBeTruthy();
  });

  it('an UNSETTLED row still counts everywhere — settlement is a review axis, not a totals one', () => {
    render(<MacroFooter items={[{ protein: 3, carbs: 17, fat: 1, settled: false }]} />, { wrapper });
    expect(screen.getByText('P 3g · C 17g · F 1g')).toBeTruthy();
  });
});
