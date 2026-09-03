import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

// Real recording/file-picker plumbing has its own tests (behind the shared
// VoiceCapture/PhotoCapture components) — here we assert QuickCaptureBar's
// OWN contract: it renders all four affordances, names them with the
// resolved meal, and forwards the clock-derived bucket. Bypass the actual
// media APIs by firing onCapture directly, the same pattern
// TodayView.test.jsx uses.
vi.mock('../capture/VoiceCapture.jsx', () => ({
  VoiceCapture: ({ onCapture, bucket, mealLabel, labelPrefix }) => (
    <button aria-label={`${labelPrefix} to ${mealLabel}`} onClick={() => onCapture('data:audio/webm;base64,zzz', bucket)}>
      {labelPrefix} to {mealLabel}
    </button>
  ),
}));
vi.mock('../capture/PhotoCapture.jsx', () => ({
  PhotoCapture: ({ onCapture, bucket, mealLabel, labelPrefix }) => (
    <button aria-label={`${labelPrefix} to ${mealLabel}`} onClick={() => onCapture('data:image/png;base64,zzz', bucket)}>
      {labelPrefix} to {mealLabel}
    </button>
  ),
}));

import { QuickCaptureBar } from './QuickCaptureBar.jsx';

function r(ui) { return render(<MantineProvider>{ui}</MantineProvider>); }

function setHour(hour) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 0, 1, hour, 0, 0));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('QuickCaptureBar', () => {
  it('renders all four affordances (text/mic/camera/barcode) with accessible names naming the resolved meal', () => {
    setHour(8); // morning -> Breakfast
    r(<QuickCaptureBar onVoiceCapture={() => {}} onPhotoCapture={() => {}} onOpenBarcode={() => {}} onAddTo={() => {}} />);

    expect(screen.getByRole('button', { name: 'Quick add to Breakfast' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Quick voice log to Breakfast' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Quick photo log to Breakfast' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Quick scan barcode to Breakfast' })).toBeTruthy();
  });

  it('the text affordance opens the add-combobox for the time-appropriate meal, via onAddTo(bucket)', () => {
    setHour(13); // afternoon -> Lunch
    const onAddTo = vi.fn();
    r(<QuickCaptureBar onVoiceCapture={() => {}} onPhotoCapture={() => {}} onOpenBarcode={() => {}} onAddTo={onAddTo} />);

    fireEvent.click(screen.getByRole('button', { name: 'Quick add to Lunch' }));
    expect(onAddTo).toHaveBeenCalledWith('afternoon');
  });

  it('a voice capture from the bar submits with the time-derived bucket', () => {
    setHour(18); // evening -> Dinner
    const onVoiceCapture = vi.fn();
    r(<QuickCaptureBar onVoiceCapture={onVoiceCapture} onPhotoCapture={() => {}} onOpenBarcode={() => {}} onAddTo={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Quick voice log to Dinner' }));
    expect(onVoiceCapture).toHaveBeenCalledWith('data:audio/webm;base64,zzz', 'evening');
  });

  it('a photo capture from the bar submits with the time-derived bucket', () => {
    setHour(22); // night -> Snacks
    const onPhotoCapture = vi.fn();
    r(<QuickCaptureBar onVoiceCapture={() => {}} onPhotoCapture={onPhotoCapture} onOpenBarcode={() => {}} onAddTo={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Quick photo log to Snacks' }));
    expect(onPhotoCapture).toHaveBeenCalledWith('data:image/png;base64,zzz', 'night');
  });

  it('opening the barcode sheet from the bar passes the time-derived bucket', () => {
    setHour(9); // morning -> Breakfast
    const onOpenBarcode = vi.fn();
    r(<QuickCaptureBar onVoiceCapture={() => {}} onPhotoCapture={() => {}} onOpenBarcode={onOpenBarcode} onAddTo={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Quick scan barcode to Breakfast' }));
    expect(onOpenBarcode).toHaveBeenCalledWith('morning');
  });

  // DELIBERATE-BREAKAGE PIN: if QuickCaptureBar ever computed its bucket
  // from something other than `bucketForHour` (e.g. reintroducing
  // getMealTimeFromHour's thresholds), hour 11 would read "morning" instead
  // of "afternoon" — this test exists specifically to catch that drift.
  it('hour 11 resolves to afternoon/Lunch, matching bucketForHour (NOT getMealTimeFromHour, which would say morning)', () => {
    setHour(11);
    r(<QuickCaptureBar onVoiceCapture={() => {}} onPhotoCapture={() => {}} onOpenBarcode={() => {}} onAddTo={() => {}} />);
    expect(screen.getByRole('button', { name: 'Quick add to Lunch' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Quick add to Breakfast' })).toBeNull();
  });
});
