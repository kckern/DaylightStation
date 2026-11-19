import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import FeedAssemblyOverlay from './FeedAssemblyOverlay.jsx';

const batches = [{ batchNumber: 1 }];
let writeText;

beforeEach(() => {
  vi.useFakeTimers();
  writeText = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function open() {
  fireEvent.click(screen.getByTitle('Feed Assembly Debug'));
}
function copy() {
  fireEvent.click(screen.getByRole('button', { name: /Copy JSON|Copied!/ }));
}

it('holds copy feedback for 1.5 seconds after the latest successful clipboard write', async () => {
  render(<FeedAssemblyOverlay batches={batches} />);
  open();
  await act(async () => copy());
  act(() => vi.advanceTimersByTime(900));
  await act(async () => copy());
  act(() => vi.advanceTimersByTime(600));
  expect(screen.getByRole('button', { name: 'Copied!' })).toBeVisible();
  act(() => vi.advanceTimersByTime(900));
  expect(screen.getByRole('button', { name: 'Copy JSON' })).toBeVisible();
  expect(writeText).toHaveBeenCalledTimes(2);
});

it('ignores a clipboard write that completes after closing and reopening the dialog', async () => {
  let resolve;
  writeText.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  render(<FeedAssemblyOverlay batches={batches} />);
  open();
  copy();
  fireEvent.click(screen.getByRole('button', { name: '×' }));
  open();
  await act(async () => resolve());
  expect(screen.getByRole('button', { name: 'Copy JSON' })).toBeVisible();
});
