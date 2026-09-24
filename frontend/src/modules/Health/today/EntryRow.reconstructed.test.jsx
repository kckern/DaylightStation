import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { EntryRow } from './EntryRow.jsx';

// Real row shape written by POST /health/nutrition/reconstruction.
const RECON = { uuid: 'r1', id: 'r1', item: 'Untracked (reconstructed)', name: 'Untracked (reconstructed)', calories: 1523,
  protein: 0, fat: 0, carbs: 0, grams: null, amount: null, unit: 'g', icon: 'default', date: '2025-11-02', mealTime: null,
  logId: 'untracked-reconstruction', log_uuid: 'untracked-reconstruction', settled: true, kind: 'item', version: 1 };

describe('EntryRow — reconstructed row', () => {
  it('is labelled as a weight-derived estimate', () => {
    render(<MantineProvider><EntryRow row={RECON} onTap={() => {}} /></MantineProvider>);
    expect(screen.getByText(/weight-derived estimate/)).toBeTruthy();
    expect(document.querySelector('.health-row-line--reconstructed')).toBeTruthy();
  });

  it('leaves a logged row unmarked', () => {
    render(<MantineProvider><EntryRow row={{ ...RECON, uuid: 'x', id: 'x', item: 'Oats', name: 'Oats', logId: 'L1', log_uuid: 'L1' }} onTap={() => {}} /></MantineProvider>);
    expect(screen.queryByText(/weight-derived estimate/)).toBeNull();
  });
});
