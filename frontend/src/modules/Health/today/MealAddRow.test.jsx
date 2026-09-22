import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn(async () => ({ items: [] })) }));
vi.mock('../capture/PhotoCapture.jsx', () => ({
  PhotoCapture: ({ bucket, labelPrefix, mealLabel }) => <button>{`${labelPrefix} to ${mealLabel} (${bucket})`}</button>,
}));
import { MealAddRow } from './MealAddRow.jsx';

const r = ui => render(<MantineProvider>{ui}</MantineProvider>);

describe('MealAddRow', () => {
  it('offers type, photo, barcode and saved meals for its own meal', () => {
    const onOpenBarcode = vi.fn(), onOpenTemplates = vi.fn();
    r(<MealAddRow bucket="afternoon" label="Lunch" date="2026-09-21" onAdded={() => {}}
      onPhotoCapture={() => {}} onOpenBarcode={onOpenBarcode} onOpenTemplates={onOpenTemplates} />);
    expect(screen.getByRole('combobox', { name: 'Add to Lunch' })).toBeTruthy();
    expect(screen.getByText('Photo to Lunch (afternoon)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Scan barcode to Lunch' }));
    expect(onOpenBarcode).toHaveBeenCalledWith('afternoon');
    fireEvent.click(screen.getByRole('button', { name: 'Saved meals for Lunch' }));
    expect(onOpenTemplates).toHaveBeenCalledWith('afternoon', null);
  });
});
