import { afterEach, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ContentValueCard } from './ContentDisplays.jsx';
import { fetchContentMetadata } from './catalogContentInfo.js';
import { useApiResource } from '../../../../frontend/src/lib/hooks/useApiResource.js';
import { catalogDescriptorOptions } from '../lib/catalogDescriptor.js';

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
  expect(await fetchContentMetadata(value)).toEqual(recovered);
  expect(fetchMetadata).toHaveBeenCalledTimes(2);
});

it('keeps the original deadline when Item Details retries a transient descriptor failure', async () => {
  vi.useFakeTimers();
  const body = Promise.withResolvers();
  const fetchMetadata = vi.fn()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce({ ok: true, json: () => body.promise });
  vi.stubGlobal('fetch', fetchMetadata);

  const value = 'plex:metadata-retry-deadline';
  const path = '/api/v1/info/plex/metadata-retry-deadline';
  const useDetails = () => useApiResource(path, { ...catalogDescriptorOptions, retryTransient: true });
  const first = renderHook(useDetails);
  const warming = fetchContentMetadata(value);
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });

  const second = renderHook(useDetails);
  expect(fetchMetadata).toHaveBeenCalledOnce();
  await act(async () => { await vi.advanceTimersByTimeAsync(4499); });
  expect(fetchMetadata).toHaveBeenCalledTimes(2);
  const retrySignal = fetchMetadata.mock.calls[1][1].signal;
  expect(retrySignal.aborted).toBe(false);

  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(retrySignal.aborted).toBe(true);
  await expect(warming).resolves.toMatchObject({ value, unresolved: true });
  expect(first.result.current.error?.message).toBe('Resource GET timed out');
  expect(second.result.current.error).toBe(first.result.current.error);
  body.resolve({ title: 'Late result' });
});

it('keeps the resolving label still while hidden and resumes elapsed time from the original lookup', () => {
  vi.useFakeTimers();
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const view = render(<MantineProvider>
    <ContentValueCard value="plex:42" />
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
  view.unmount();
});
