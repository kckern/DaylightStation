import { it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { act, render, renderHook, fireEvent, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { peekApiResource, resetApiResourceCache, useApiResource } from '../../../../frontend/src/lib/hooks/useApiResource.js';
import ImagePickerModal from './ImagePickerModal.jsx';

afterEach(() => {
  resetApiResourceCache();
  vi.unstubAllGlobals();
});

it('preserves multipart boundaries and imports a pasted URL as JSON once per gesture', async () => {
  const onSave = vi.fn();
  const fetch = vi.fn(async () => Response.json({ path: '/media/imported.jpg' }));
  vi.stubGlobal('fetch', fetch);
  render(<MantineProvider><ImagePickerModal opened onClose={() => {}} onSave={onSave} /></MantineProvider>);

  const file = new File(['photo'], 'original.png', { type: 'image/png' });
  const clipboardData = { items: [{ type: file.type, getAsFile: () => file }] };
  fireEvent.paste(document, { clipboardData });
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  const [fileUrl, fileOptions] = fetch.mock.calls[0];
  expect(fileUrl).toBe(`${location.origin}/api/v1/admin/images/upload`);
  expect(fileOptions.method).toBe('POST');
  expect(fileOptions.headers['Content-Type']).toBeUndefined();
  expect(fileOptions.headers['X-Daylight-Device']).toBeTruthy();
  const part = fileOptions.body.get('image');
  expect(part.type).toBe('image/png');
  expect(part.name).toMatch(/^paste-\d+\.png$/);

  fireEvent.paste(document, { clipboardData: { items: [], getData: () => 'https://example.test/art.jpg' } });
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
  const [url, options] = fetch.mock.calls[1];
  expect(url).toBe(`${location.origin}/api/v1/admin/images/upload-url`);
  expect(options.headers['Content-Type']).toBe('application/json');
  expect(JSON.parse(options.body)).toEqual({ url: 'https://example.test/art.jpg' });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('loads artwork on demand and recovers from a failed browse without reopening the picker', async () => {
  const onSave = vi.fn();
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response('', { status: 404 }))
    .mockResolvedValueOnce(Response.json({ images: [{ filename: 'choice.jpg', path: '/media/choice.jpg' }] }));
  vi.stubGlobal('fetch', fetch);
  render(<MantineProvider><ImagePickerModal opened onClose={() => {}} onSave={onSave} /></MantineProvider>);
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('tab', { name: 'Browse' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
  fireEvent.click(await screen.findByRole('button', { name: 'choice.jpg' }));
  expect(onSave.mock.calls).toEqual([['/media/choice.jpg']]);
});

it('refreshes the mounted artwork list once after an upload without replacing a later selection', async () => {
  const listPath = '/api/v1/admin/images/list';
  const otherPath = `${listPath}?scope=other`;
  const uploadPath = '/api/v1/admin/images/upload-url';
  const later = { filename: 'later.jpg', path: '/media/later.jpg' };
  const uploaded = { filename: 'first.jpg', path: '/media/first.jpg' };
  let finishUpload;
  let images = [later];
  const onSave = vi.fn();
  const fetch = vi.fn(async (url, { method }) => {
    if (method === 'GET' && url === location.origin + listPath) return Response.json({ images });
    if (method === 'GET' && url === location.origin + otherPath) return Response.json({ images: [] });
    if (method === 'POST' && url === location.origin + uploadPath) {
      return new Promise(resolve => { finishUpload = resolve; });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  const requests = () => fetch.mock.calls.map(([url, { method }]) => [method, url]);
  function Picker() {
    const [currentImage, setCurrentImage] = useState(null);
    return <ImagePickerModal opened currentImage={currentImage} onSave={path => {
      onSave(path);
      setCurrentImage(path);
    }} />;
  }

  const { result } = renderHook(() => useApiResource(otherPath, { swr: true }));
  await waitFor(() => expect(result.current.data).toEqual({ images: [] }));
  render(<MantineProvider><Picker /></MantineProvider>);
  fireEvent.paste(document, { clipboardData: { items: [], getData: () => 'https://example.test/first.jpg' } });
  const browse = screen.getByRole('tab', { name: 'Browse' });
  fireEvent.click(browse);
  const selection = await screen.findByRole('button', { name: later.filename });
  fireEvent.click(selection);
  expect(selection).toHaveClass('selected');
  expect(screen.queryByRole('button', { name: uploaded.filename })).toBeNull();
  const beforeUpload = [
    ['GET', location.origin + otherPath],
    ['POST', location.origin + uploadPath],
    ['GET', location.origin + listPath],
  ];
  expect(requests()).toEqual(beforeUpload);

  await act(async () => {
    images = [uploaded, later];
    finishUpload(Response.json({ path: uploaded.path }));
  });

  expect(await screen.findByRole('button', { name: uploaded.filename })).toBeVisible();
  expect(browse).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('button', { name: later.filename })).toHaveClass('selected');
  expect(onSave.mock.calls).toEqual([[later.path]]);
  expect(peekApiResource(listPath)).toEqual({ images: [uploaded, later] });
  expect(requests()).toEqual([...beforeUpload, ['GET', location.origin + listPath]]);
});
