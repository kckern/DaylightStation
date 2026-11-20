import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Routes, Route, useParams } from 'react-router-dom';

const api = vi.fn();
vi.mock("../../../../../frontend/src/lib/api.mjs", () => ({
  DaylightAPI: (...a) => api(...a),
  buildHeaders: (token, withContentType) => ({ 'X-Test': 'headers', withContentType: String(withContentType) }),
}));
const logged = [];
vi.mock("../../../../../frontend/src/lib/logging/Logger.js", () => {
  const rec = (level) => (event, data) => logged.push({ level, event, data });
  return { default: () => ({ child: () => ({ info: rec('info'), debug: rec('debug'), warn: rec('warn'), error: rec('error') }) }) };
});
const notify = vi.fn();
vi.mock('@mantine/notifications', () => ({ notifications: { show: (...a) => notify(...a) } }));

import { SheetMusicLibrary } from "./index.js";

const LIBRARY = {
  folders: ['classical', 'hymns'],
  scores: [
    { id: 'files:docs/sheet-music/classical/fur-elise.musicxml', folder: 'classical', file: 'fur-elise.musicxml', format: 'musicxml',
      title: 'Fur Elise', composer: 'Beethoven', poster: 'scan', learn: 'approved',
      learners: [{ userId: 'learner-a', passagesWithProgress: 3 }, { userId: 'learner-b', passagesWithProgress: 1 }] },
    { id: 'files:docs/sheet-music/classical/minuet-in-g.mxl', folder: 'classical', file: 'minuet-in-g.mxl', format: 'mxl',
      title: 'Minuet in G', composer: 'Petzold', poster: 'none', learn: 'none', learners: [] },
    { id: 'files:docs/sheet-music/hymns/sample-hymn.musicxml', folder: 'hymns', file: 'sample-hymn.musicxml', format: 'musicxml',
      title: 'Sample Hymn', composer: null, poster: 'generated', learn: 'approved+draft', learners: [] },
    { id: 'files:docs/sheet-music/hymns/broken-learn.musicxml', folder: 'hymns', file: 'broken-learn.musicxml', format: 'musicxml',
      title: 'Broken Learn', composer: null, poster: 'generated', learn: null, error: 'LEARN_UNREADABLE', learners: [] },
    { id: 'files:docs/sheet-music/hymns/old-segments.musicxml', folder: 'hymns', file: 'old-segments.musicxml', format: 'musicxml',
      title: 'Old Segments', composer: null, poster: 'scan', learn: 'stale', learners: [] },
  ],
};

function Echo() {
  const params = useParams();
  return <div data-testid="echo">{params['*']}</div>;
}

const renderLib = () => render(
  <MantineProvider>
    <MemoryRouter initialEntries={['/admin/content/sheet-music']}>
      <Routes>
        <Route path="/admin/content/sheet-music" element={<SheetMusicLibrary />} />
        <Route path="/admin/content/sheet-music/view/*" element={<Echo />} />
      </Routes>
    </MemoryRouter>
  </MantineProvider>,
);

const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });

beforeEach(() => {
  api.mockReset();
  notify.mockReset();
  logged.length = 0;
  api.mockResolvedValue(LIBRARY);
  global.fetch = vi.fn();
});
afterEach(() => cleanup());

const rowFor = (title) => screen.getByText(title).closest('tr');

describe('SheetMusicLibrary', () => {
  it('renders folders, badges and the unreadable Learn state', async () => {
    renderLib();
    await waitFor(() => expect(screen.getByText('Fur Elise')).toBeTruthy());
    expect(api).toHaveBeenCalledWith('api/v1/admin/sheet-music');
    expect(screen.getByText('classical')).toBeTruthy();
    expect(screen.getByText('hymns')).toBeTruthy();

    const fur = within(rowFor('Fur Elise'));
    expect(fur.getByText('fur-elise.musicxml')).toBeTruthy();
    expect(fur.getByText('Beethoven')).toBeTruthy();
    expect(fur.getByText('MusicXML')).toBeTruthy();
    expect(fur.getByText('scan')).toBeTruthy();
    expect(fur.getByText('approved')).toBeTruthy();
    expect(fur.getByText('2 learners')).toBeTruthy();

    expect(within(rowFor('Minuet in G')).getByText('MXL')).toBeTruthy();
    expect(within(rowFor('Sample Hymn')).getByText('approved + draft')).toBeTruthy();
    const broken = within(rowFor('Broken Learn'));
    expect(broken.getByText('unreadable')).toBeTruthy();
    expect(broken.getByText('LEARN_UNREADABLE')).toBeTruthy();
    expect(logged.some((l) => l.event === 'admin.sheetmusic.mounted')).toBe(true);
  });

  it('filters change visible rows and show counts', async () => {
    renderLib();
    await waitFor(() => expect(screen.getByText('Fur Elise')).toBeTruthy());
    expect(screen.getByText('All (5)')).toBeTruthy();
    expect(screen.getByText('No poster (1)')).toBeTruthy();
    expect(screen.getByText('No segments (1)')).toBeTruthy();
    expect(screen.getByText('Draft pending (1)')).toBeTruthy();
    expect(screen.getByText('Stale (1)')).toBeTruthy();

    fireEvent.click(screen.getByText('No poster (1)'));
    await waitFor(() => expect(screen.queryByText('Fur Elise')).toBeNull());
    expect(screen.getByText('Minuet in G')).toBeTruthy();
    expect(screen.queryByText('hymns')).toBeNull();

    fireEvent.click(screen.getByText('Draft pending (1)'));
    await waitFor(() => expect(screen.getByText('Sample Hymn')).toBeTruthy());
    expect(screen.queryByText('Minuet in G')).toBeNull();

    fireEvent.click(screen.getByText('Stale (1)'));
    await waitFor(() => expect(screen.getByText('Old Segments')).toBeTruthy());
    expect(screen.queryByText('Sample Hymn')).toBeNull();
  });

  it('row click navigates to the score id under view/', async () => {
    renderLib();
    await waitFor(() => expect(screen.getByText('Fur Elise')).toBeTruthy());
    fireEvent.click(rowFor('Fur Elise'));
    await waitFor(() => expect(screen.getByTestId('echo').textContent)
      .toBe('files:docs/sheet-music/classical/fur-elise.musicxml'));
  });

  const openUpload = async () => {
    renderLib();
    await waitFor(() => expect(screen.getByText('Fur Elise')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /upload/i }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    const dialog = within(screen.getByRole('dialog'));
    const file = new File(['<score-partwise/>'], 'New Piece.musicxml', { type: 'application/xml' });
    const fileInput = document.querySelector('input[type="file"]');
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.click(dialog.getByPlaceholderText('Choose a folder'));
    fireEvent.click(await screen.findByRole('option', { name: 'hymns' }));
    fireEvent.change(dialog.getByLabelText(/file name/i), { target: { value: 'My-Piece' } });
    return { dialog, file };
  };

  it('upload posts FormData and navigates to the new score', async () => {
    global.fetch.mockResolvedValue(jsonResponse(201, {
      id: 'files:docs/sheet-music/hymns/my-piece.musicxml', title: 'My Piece', composer: null, filename: 'my-piece.musicxml',
    }));
    const { dialog, file } = await openUpload();
    expect(dialog.getByLabelText(/file name/i).value).toBe('my-piece');
    fireEvent.click(dialog.getByRole('button', { name: /^upload$/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/v1/admin/sheet-music/upload');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'X-Test': 'headers', withContentType: 'false' });
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.body.get('file').name).toBe(file.name);
    expect(init.body.get('folder')).toBe('hymns');
    expect(init.body.get('filename')).toBe('my-piece.musicxml');
    await waitFor(() => expect(screen.getByTestId('echo').textContent)
      .toBe('files:docs/sheet-music/hymns/my-piece.musicxml'));
    expect(notify).toHaveBeenCalled();
    expect(logged.some((l) => l.event === 'admin.sheetmusic.upload-done')).toBe(true);
  });

  it('upload 409 basename-exists shows its message and keeps the modal open', async () => {
    global.fetch.mockResolvedValue(jsonResponse(409, { error: 'basename-exists' }));
    const { dialog } = await openUpload();
    fireEvent.click(dialog.getByRole('button', { name: /^upload$/i }));
    await waitFor(() => expect(dialog.getByText(/already has a score with that file name/i)).toBeTruthy());
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.queryByTestId('echo')).toBeNull();
    expect(logged.some((l) => l.event === 'admin.sheetmusic.upload-failed' && l.data.code === 'basename-exists')).toBe(true);
  });

  it('GET failure shows retry and retry refetches', async () => {
    api.mockRejectedValueOnce(new Error('HTTP 500'));
    renderLib();
    const retry = await screen.findByRole('button', { name: /retry/i });
    expect(api).toHaveBeenCalledTimes(1);
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByText('Fur Elise')).toBeTruthy());
    expect(api).toHaveBeenCalledTimes(2);
  });
});
