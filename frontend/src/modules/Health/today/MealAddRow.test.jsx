import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn(async () => ({ items: [] })) }));
vi.mock('../capture/PhotoCapture.jsx', () => ({
  PhotoCapture: ({ bucket, labelPrefix, mealLabel }) => <button>{`${labelPrefix} to ${mealLabel} (${bucket})`}</button>,
}));
vi.mock('../capture/VoiceCapture.jsx', () => ({
  VoiceCapture: ({ bucket, labelPrefix, mealLabel, onCapture }) =>
    <button onClick={() => onCapture('data:audio', bucket, { isDeparted: () => false })}>{`${labelPrefix} to ${mealLabel}`}</button>,
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

  it('its mic adds what was said to this meal on the viewed day, with no selection', () => {
    const onVoiceCapture = vi.fn();
    r(<MealAddRow bucket="evening" label="Dinner" date="2026-09-21" onAdded={() => {}} onVoiceCapture={onVoiceCapture}
      onPhotoCapture={() => {}} onOpenBarcode={() => {}} onOpenTemplates={() => {}} />);
    fireEvent.click(screen.getByText('Speak foods to Dinner'));
    expect(onVoiceCapture).toHaveBeenCalledWith('data:audio', 'evening', expect.objectContaining({ date: '2026-09-21' }));
    expect(onVoiceCapture.mock.calls[0][2].selectedIds).toBeUndefined();
  });
});
