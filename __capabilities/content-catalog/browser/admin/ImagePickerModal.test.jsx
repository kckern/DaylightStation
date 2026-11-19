import { it, expect, vi, afterEach } from 'vitest';
import { act, render, fireEvent, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import ImagePickerModal from './ImagePickerModal.jsx';

afterEach(() => vi.unstubAllGlobals());

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

it('keeps a later browse selection when an earlier upload finishes', async () => {
  let finishUpload;
  const onSave = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async url => url.endsWith('/list')
    ? Response.json({ images: [{ filename: 'later.jpg', path: '/media/later.jpg' }] })
    : new Promise(resolve => { finishUpload = resolve; })));
  render(<MantineProvider><ImagePickerModal opened onSave={onSave} /></MantineProvider>);
  fireEvent.paste(document, { clipboardData: { items: [], getData: () => 'https://example.test/first.jpg' } });
  fireEvent.click(screen.getByRole('tab', { name: 'Browse' }));
  fireEvent.click(await screen.findByRole('button', { name: 'later.jpg' }));
  await act(async () => { finishUpload(Response.json({ path: '/media/first.jpg' })); });
  expect(onSave.mock.calls).toEqual([['/media/later.jpg']]);
});
