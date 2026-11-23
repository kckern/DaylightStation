import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { BleepLevelPanel } from './BleepLevelPanel.jsx';

const show = (props = {}) => {
  const p = { household: 0.35, film: 0.5, onFilm: vi.fn(), onHousehold: vi.fn(), onTest: vi.fn(), ...props };
  render(<MantineProvider><BleepLevelPanel {...p} /></MantineProvider>);
  return p;
};

describe('BleepLevelPanel', () => {
  it('shows the household level and this film\'s level, or "Follows household"', () => {
    show();
    expect(screen.getByLabelText('Household level').textContent).toBe('35 %');
    expect(screen.getByLabelText('This film level').textContent).toBe('50 %');
  });
  it('says Follows household when the film has no level of its own', () => {
    show({ film: null });
    expect(screen.getByLabelText('This film level').textContent).toBe('Follows household');
  });
  it('− / + on this film write bleepLevel ± 0.05, clamped 0–1', () => {
    const p = show();
    fireEvent.click(screen.getByRole('button', { name: 'This film louder' }));
    expect(p.onFilm).toHaveBeenLastCalledWith(0.55);
    fireEvent.click(screen.getByRole('button', { name: 'This film quieter' }));
    expect(p.onFilm).toHaveBeenLastCalledWith(0.45);
  });
  it('clamps at the ends', () => {
    const p = show({ film: 1, household: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'This film louder' }));
    expect(p.onFilm).toHaveBeenLastCalledWith(1);
    fireEvent.click(screen.getByRole('button', { name: 'Household quieter' }));
    expect(p.onHousehold).toHaveBeenLastCalledWith(0);
  });
  it('Follow household writes bleepLevel: null', () => {
    const p = show();
    fireEvent.click(screen.getByRole('button', { name: 'Follow household' }));
    expect(p.onFilm).toHaveBeenCalledWith(null);
  });
  it('− / + on the household level write the household setting', () => {
    const p = show();
    fireEvent.click(screen.getByRole('button', { name: 'Household louder' }));
    expect(p.onHousehold).toHaveBeenLastCalledWith(0.4);
    fireEvent.click(screen.getByRole('button', { name: 'Household quieter' }));
    expect(p.onHousehold).toHaveBeenLastCalledWith(0.3);
  });
  it('Test plays a bleep at the shown level', () => {
    const p = show();
    fireEvent.click(screen.getByRole('button', { name: 'Test bleep' }));
    expect(p.onTest).toHaveBeenCalled();
  });
});

describe('playTestBleep', () => {
  it('logs (debug) when the tone cannot sound, even on the retry', async () => {
    vi.resetModules();
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: () => log };
    vi.doMock('../../../lib/ui/index.js', () => ({ createAppLogger: () => log }));
    vi.doMock('../../../../../__app_modules/media/media/browser/content-filter/adminWorkspace.mjs', () => ({ createBleepTone: () => ({ start: () => false, stop: () => {} }) }));
    const { playTestBleep } = await import('./BleepLevelPanel.jsx');
    vi.useFakeTimers();
    playTestBleep(0.4);
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
    expect(log.debug).toHaveBeenCalledWith('content_filter.review.bleep_test_silent', { level: 0.4 });
  });
});
