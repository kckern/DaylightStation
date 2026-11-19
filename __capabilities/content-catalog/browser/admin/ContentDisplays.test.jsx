import { afterEach, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ContentValueCard } from './ContentDisplays.jsx';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('keeps the resolving label still while hidden and resumes elapsed time from the original lookup', () => {
  vi.useFakeTimers();
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const contentInfoMap = new Map();
  const view = render(<MantineProvider>
    <ContentValueCard value="plex:42" contentInfoMap={contentInfoMap} />
  </MantineProvider>);
  const label = screen.getByText('Resolving...');
  act(() => { vi.advanceTimersByTime(2000); });
  expect(label).toHaveTextContent('Resolving... 2s');
  act(() => {
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(7500);
  });
  expect(label).toHaveTextContent('Resolving... 2s');
  act(() => {
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(label).toHaveTextContent('Resolving... 9s');
  expect(contentInfoMap.size).toBe(0);
  view.unmount();
});
