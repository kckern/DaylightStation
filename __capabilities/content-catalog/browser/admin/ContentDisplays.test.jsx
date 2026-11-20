import { afterEach, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ContentValueCard, fetchContentMetadata } from './ContentDisplays.jsx';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('expires a shared metadata read during body parsing and lets the same key recover', async () => {
  vi.useFakeTimers();
  const body = Promise.withResolvers();
  const readBody = vi.fn(() => body.promise);
  let signal;
  const fetchMetadata = vi.fn()
    .mockImplementationOnce(async (_url, options) => {
      signal = options.signal;
      signal.addEventListener('abort', () => body.reject(signal.reason), { once: true });
      return { ok: true, json: readBody };
    })
    .mockResolvedValueOnce(Response.json({ title: 'Recovered title' }));
  vi.stubGlobal('fetch', fetchMetadata);

  const value = 'plex:metadata-deadline';
  const first = fetchContentMetadata(value);
  const concurrent = fetchContentMetadata(value);
  await vi.advanceTimersByTimeAsync(4999);
  expect(fetchMetadata).toHaveBeenCalledOnce();
  expect(readBody).toHaveBeenCalledOnce();
  expect(signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(signal.aborted).toBe(true);
  const unresolved = { value, title: 'metadata-deadline', source: 'plex', type: null, unresolved: true };
  await expect(Promise.all([first, concurrent])).resolves.toEqual([unresolved, unresolved]);

  const recovered = await fetchContentMetadata(value);
  expect(recovered).toMatchObject({ value, title: 'Recovered title', unresolved: false });
  expect(await fetchContentMetadata(value)).toBe(recovered);
  expect(fetchMetadata).toHaveBeenCalledTimes(2);
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
