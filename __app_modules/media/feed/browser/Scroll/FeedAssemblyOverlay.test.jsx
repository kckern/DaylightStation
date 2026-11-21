import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MantineProvider } from '@mantine/core';
import { DismissStackProvider } from '@/lib/ui/dismiss/DismissStackProvider.jsx';
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
  render(<MantineProvider><FeedAssemblyOverlay batches={batches} /></MantineProvider>);
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
  render(<MantineProvider><FeedAssemblyOverlay batches={batches} /></MantineProvider>);
  open();
  copy();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  open();
  await act(async () => resolve());
  expect(screen.getByRole('button', { name: 'Copy JSON' })).toBeVisible();
});

it('uses the shared modal contract for dialog semantics, focus containment, Escape and return focus', async () => {
  render(
    <MantineProvider>
      <DismissStackProvider>
        <FeedAssemblyOverlay batches={[{
          tiers: { wire: { selected: 1, allocated: 1, sources: { Local: 1 } } },
        }]} />
      </DismissStackProvider>
    </MantineProvider>
  );
  const opener = screen.getByTitle('Feed Assembly Debug');
  fireEvent.click(opener);

  const dialog = screen.getByRole('dialog', { name: 'Feed Assembly' });
  const close = screen.getByRole('button', { name: 'Close' });
  const lastFilter = screen.getByRole('button', { name: 'Local 1' });
  act(() => vi.advanceTimersByTime(0));
  expect(close).toHaveFocus();

  lastFilter.focus();
  fireEvent.keyDown(lastFilter, { key: 'Tab' });
  expect(close).toHaveFocus();

  fireEvent.keyDown(close, { key: 'Escape' });
  act(() => vi.advanceTimersByTime(0));
  expect(screen.queryByRole('dialog', { name: 'Feed Assembly' })).toBeNull();
  await act(async () => Promise.resolve());
  expect(opener).toHaveFocus();
  expect(dialog).not.toBeInTheDocument();
});

it('exposes tier and source filters as keyboard-operable pressed-state buttons', () => {
  const onFilterChange = vi.fn();
  render(
    <MantineProvider>
      <FeedAssemblyOverlay batches={[{
        tiers: {
          wire: { selected: 2, allocated: 3, sources: { Local: 2 } },
        },
      }]} onFilterChange={onFilterChange} />
    </MantineProvider>
  );
  open();

  const tier = screen.getByRole('button', { name: 'wire' });
  const source = screen.getByRole('button', { name: 'Local 2' });
  expect(screen.getByRole('button', { name: 'Clear All' })).toHaveAttribute('aria-disabled', 'true');
  expect(tier).toHaveAttribute('aria-pressed', 'false');
  expect(source).toHaveAttribute('aria-pressed', 'false');

  fireEvent.click(tier);
  expect(tier).toHaveAttribute('aria-pressed', 'true');
  expect(onFilterChange).toHaveBeenLastCalledWith({ tiers: ['wire'], sources: [] });

  fireEvent.click(source);
  expect(source).toHaveAttribute('aria-pressed', 'true');
  expect(onFilterChange).toHaveBeenLastCalledWith({ tiers: ['wire'], sources: ['Local'] });

  const clear = screen.getByRole('button', { name: 'Clear All' });
  clear.focus();
  fireEvent.click(clear);
  expect(clear).toHaveAttribute('aria-disabled', 'true');
  expect(clear).toHaveFocus();
});
