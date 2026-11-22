import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Routes, Route, useParams, useNavigate } from 'react-router-dom';

const api = vi.fn();
const apiText = vi.fn();
vi.mock("../../../../../frontend/src/lib/api.mjs", () => ({
  DaylightAPI: (...a) => api(...a),
  DaylightAPIText: (...a) => apiText(...a),
  daylightApiResponse: (path, init) => fetch(path, {
    method: init.method,
    headers: {
      'X-Test': 'headers',
      withContentType: String(!(init.data instanceof FormData)),
      ...(localStorage.getItem('ds_token') ? { Authorization: `Bearer ${localStorage.getItem('ds_token')}` } : {}),
      ...(init.contentType ? { 'Content-Type': init.contentType } : {}),
    },
    ...(init.data !== undefined ? { body: init.data } : {}),
    ...(init.body !== undefined ? { body: init.body } : {}),
  }),
  buildHeaders: (token, withContentType) => ({
    'X-Test': 'headers',
    withContentType: String(withContentType),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }),
}));
const logged = [];
vi.mock("../../../../../frontend/src/lib/logging/Logger.js", () => {
  const rec = (level) => (event, data) => logged.push({ level, event, data });
  return { default: () => ({ child: () => ({ info: rec('info'), debug: rec('debug'), warn: rec('warn'), error: rec('error') }) }) };
});
const engrave = vi.fn();
vi.mock("../../../../../__capabilities/music-notation/browser/renderers/osmdRender.js", () => ({
  osmdEngrave: (...a) => engrave(...a),
  extractPerStaffGeometry: () => [{ system: 0, staff: 0, top: 0, left: 0, right: 400, lineSpacing: 5 }],
}));
const ENGRAVED = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100"><g class="staffline"><path d="M0 0L400 0"/></g></svg>';
const notify = vi.fn();
vi.mock('@mantine/notifications', () => ({ notifications: { show: (...a) => notify(...a) } }));

import { SheetMusicLibrary } from "./index.js";
import { scorePath } from "./SheetMusicLibrary.jsx";

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

function BackControl() {
  const navigate = useNavigate();
  return <button type="button" data-testid="router-back" onClick={() => navigate(-1)}>Test back</button>;
}

const renderLib = (initialEntries = ['/admin/content/sheet-music']) => render(
  <MantineProvider>
    <MemoryRouter initialEntries={initialEntries}>
      <BackControl />
      <Routes>
        <Route path="/admin/previous" element={<div>previous page</div>} />
        <Route path="/admin/content/sheet-music" element={<SheetMusicLibrary />} />
        <Route path="/admin/content/sheet-music/view/*" element={<Echo />} />
      </Routes>
    </MemoryRouter>
  </MantineProvider>,
);

const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });

beforeEach(() => {
  api.mockReset();
  apiText.mockReset();
  engrave.mockReset();
  apiText.mockImplementation(async (path) => `<score-partwise path="${path}"/>`);
  engrave.mockImplementation(async (host) => { host.innerHTML = ENGRAVED; return { osmd: {} }; });
  notify.mockReset();
  logged.length = 0;
  api.mockResolvedValue(LIBRARY);
  global.fetch = vi.fn();
  localStorage.removeItem('ds_token');
});
afterEach(() => { cleanup(); localStorage.removeItem('ds_token'); });

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

  const openUpload = async (initialEntries) => {
    renderLib(initialEntries);
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
    localStorage.setItem('ds_token', 'session-token-1');
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
    expect(init.headers).toEqual({ 'X-Test': 'headers', withContentType: 'false', Authorization: 'Bearer session-token-1' });
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.body.get('file').name).toBe(file.name);
    expect(init.body.get('folder')).toBe('hymns');
    expect(init.body.get('filename')).toBe('my-piece.musicxml');
    await waitFor(() => expect(screen.getByTestId('echo').textContent)
      .toBe('files:docs/sheet-music/hymns/my-piece.musicxml'));
    expect(notify).toHaveBeenCalled();
    expect(logged.some((l) => l.event === 'admin.sheetmusic.upload-done')).toBe(true);
  });

  it('does not navigate back to the score when upload finishes after leaving the library', async () => {
    let finishUpload;
    global.fetch.mockReturnValue(new Promise((resolve) => { finishUpload = resolve; }));
    const { dialog } = await openUpload(['/admin/previous', '/admin/content/sheet-music']);
    fireEvent.click(dialog.getByRole('button', { name: /^upload$/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId('router-back'));
    await waitFor(() => expect(screen.getByText('previous page')).toBeTruthy());
    finishUpload(jsonResponse(201, {
      id: 'files:docs/sheet-music/hymns/my-piece.musicxml', title: 'My Piece', composer: null, filename: 'my-piece.musicxml',
    }));

    await waitFor(() => expect(screen.getByText('previous page')).toBeTruthy());
    expect(screen.queryByTestId('echo')).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
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

  it('locks upload fields in flight and restores the same draft after a conflict', async () => {
    let finishUpload;
    global.fetch.mockReturnValue(new Promise(resolve => { finishUpload = resolve; }));
    const { dialog, file } = await openUpload();
    const fileControl = dialog.getByText(file.name).closest('button');
    const clearFile = dialog.getByRole('button', { name: 'Clear selected file' });
    const folderInput = dialog.getByPlaceholderText('Choose a folder');
    const filenameInput = dialog.getByLabelText(/file name/i);

    fireEvent.click(dialog.getByRole('button', { name: /^upload$/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    expect(fileControl).toBeDisabled();
    expect(folderInput).toBeDisabled();
    expect(filenameInput).toBeDisabled();
    expect(clearFile).toBeDisabled();

    await act(async () => finishUpload(jsonResponse(409, { error: 'basename-exists' })));
    expect(await dialog.findByText(/already has a score with that file name/i)).toBeVisible();
    expect(fileControl).toBeEnabled();
    expect(folderInput).toBeEnabled();
    expect(filenameInput).toBeEnabled();
    expect(clearFile).toBeEnabled();
    expect(folderInput).toHaveValue('hymns');
    expect(filenameInput).toHaveValue('my-piece');
    expect(dialog.getByText(file.name)).toBeVisible();
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

  it('an unknown error code shows the generic message', async () => {
    global.fetch.mockResolvedValue(jsonResponse(500, { error: 'something-new' }));
    const { dialog } = await openUpload();
    fireEvent.click(dialog.getByRole('button', { name: /^upload$/i }));
    await waitFor(() => expect(dialog.getByText(/the upload failed/i)).toBeTruthy());
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('a rejected fetch shows the network message', async () => {
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const { dialog } = await openUpload();
    fireEvent.click(dialog.getByRole('button', { name: /^upload$/i }));
    await waitFor(() => expect(dialog.getByText(/could not be reached/i)).toBeTruthy());
    expect(logged.some((l) => l.event === 'admin.sheetmusic.upload-failed' && l.data.code === 'network')).toBe(true);
  });

  it('shows a loading skeleton until the list arrives', async () => {
    let resolve;
    api.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderLib();
    expect(screen.getByTestId('sheet-music-loading')).toBeTruthy();
    resolve(LIBRARY);
    await waitFor(() => expect(screen.getByText('Fur Elise')).toBeTruthy());
    expect(screen.queryByTestId('sheet-music-loading')).toBeNull();
  });

  it('No segments filter shows only learn: none rows', async () => {
    renderLib();
    await waitFor(() => expect(screen.getByText('Fur Elise')).toBeTruthy());
    fireEvent.click(screen.getByText('No segments (1)'));
    await waitFor(() => expect(screen.queryByText('Fur Elise')).toBeNull());
    expect(screen.getByText('Minuet in G')).toBeTruthy();
    expect(screen.queryByText('Broken Learn')).toBeNull();
    expect(screen.queryByText('Old Segments')).toBeNull();
  });

  it('an empty library says so under All', async () => {
    api.mockResolvedValue({ scores: [], folders: ['classical'] });
    renderLib();
    await waitFor(() => expect(screen.getByText('No scores in the library yet.')).toBeTruthy());
  });

  it('titles are real links to the score page', async () => {
    renderLib();
    await waitFor(() => expect(screen.getByText('Fur Elise')).toBeTruthy());
    const link = screen.getByRole('link', { name: 'Fur Elise' });
    expect(link.getAttribute('href'))
      .toBe('/admin/content/sheet-music/view/files:docs/sheet-music/classical/fur-elise.musicxml');
    fireEvent.click(link);
    await waitFor(() => expect(screen.getByTestId('echo').textContent)
      .toBe('files:docs/sheet-music/classical/fur-elise.musicxml'));
  });

  it('the learners count is keyboard-focusable', async () => {
    renderLib();
    await waitFor(() => expect(screen.getByText('2 learners')).toBeTruthy());
    expect(screen.getByText('2 learners').getAttribute('tabindex')).toBe('0');
  });

  it('Upload is disabled when no folders loaded', async () => {
    api.mockResolvedValue({ scores: LIBRARY.scores, folders: [] });
    renderLib();
    await waitFor(() => expect(screen.getByText('Fur Elise')).toBeTruthy());
    expect(screen.getByRole('button', { name: /upload/i }).disabled).toBe(true);
  });

  it('Retry shows loading while the list reloads', async () => {
    api.mockRejectedValueOnce(new Error('HTTP 500'));
    renderLib();
    const retry = await screen.findByRole('button', { name: /retry/i });
    let resolve;
    api.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    fireEvent.click(retry);
    await waitFor(() => expect(retry.getAttribute('data-loading')).toBe('true'));
    resolve(LIBRARY);
    await waitFor(() => expect(screen.getByText('Fur Elise')).toBeTruthy());
  });
});

describe('scorePath', () => {
  const ODD_IDS = [
    'files:docs/sheet-music/classical/fur-elise.musicxml',
    'files:docs/sheet-music/a b/two words.musicxml',
    'files:docs/sheet-music/x/etude #3.musicxml',
    'files:docs/sheet-music/x/what?.mxl',
    'files:docs/sheet-music/x/100%.mxl',
    'files:docs/sheet-music/x/already%25encoded.mxl',
    'files:docs/sheet-music/x/colon:inside.musicxml',
  ];

  function Go({ id }) {
    const navigate = useNavigate();
    return <button type="button" onClick={() => navigate(scorePath(id))}>go</button>;
  }

  it.each(ODD_IDS)('round-trips %s through the view/* splat', async (id) => {
    render(
      <MemoryRouter initialEntries={['/admin/content/sheet-music']}>
        <Routes>
          <Route path="/admin/content/sheet-music" element={<Go id={id} />} />
          <Route path="/admin/content/sheet-music/view/*" element={<Echo />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('go'));
    await waitFor(() => expect(screen.getByTestId('echo').textContent).toBe(id));
  });

  describe('Generate missing posters', () => {
    const MISSING = ['nocturne', 'gavotte', 'bourree'].map((name) => ({
      id: `files:docs/sheet-music/classical/${name}.musicxml`, folder: 'classical', file: `${name}.musicxml`, format: 'musicxml',
      title: name[0].toUpperCase() + name.slice(1), composer: null, poster: 'none', learn: 'none', learners: [],
    }));
    const posterCalls = () => global.fetch.mock.calls.filter(([url]) => String(url).startsWith('/api/v1/admin/sheet-music/poster'));

    it('walks the scores without a poster one at a time, then reloads the library', async () => {
      api.mockResolvedValue({ ...LIBRARY, scores: [...LIBRARY.scores, ...MISSING] });
      let active = 0;
      let maxActive = 0;
      engrave.mockImplementation(async (host) => {
        active += 1; maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 1));
        active -= 1;
        host.innerHTML = ENGRAVED;
        return { osmd: {} };
      });
      global.fetch.mockResolvedValue(jsonResponse(201, { poster: 'generated' }));
      renderLib();
      const button = await screen.findByTestId('generate-missing-posters');
      expect(button.textContent).toBe('Generate missing posters (4)'); // Minuet + the three above
      fireEvent.click(button);
      await waitFor(() => expect(screen.getByTestId('poster-run-status').textContent).toBe('Generated 4 of 4 posters.'));
      expect(maxActive).toBe(1);
      const ids = posterCalls().map(([url]) => decodeURIComponent(String(url).split('?id=')[1]));
      expect(ids).toEqual(['files:docs/sheet-music/classical/minuet-in-g.mxl', ...MISSING.map((m) => m.id)]);
      expect(posterCalls()[0][1].body).toContain('data-daylight-poster="generated"');
      expect(apiText).toHaveBeenCalledWith(`api/v1/proxy/media/stream/${encodeURIComponent('docs/sheet-music/classical/minuet-in-g.mxl')}`);
      await waitFor(() => expect(api).toHaveBeenCalledTimes(2)); // reloaded
      expect(logged.find((l) => l.event === 'admin.sheetmusic.posters-done')?.data).toMatchObject({ total: 4, saved: 4, failed: 0 });
    });

    it('lists the failures by title and keeps going', async () => {
      api.mockResolvedValue({ ...LIBRARY, scores: [...LIBRARY.scores, ...MISSING] });
      global.fetch.mockImplementation(async (url) => (String(url).includes('gavotte')
        ? jsonResponse(409, { error: 'has-scan' }) : jsonResponse(201, {})));
      renderLib();
      fireEvent.click(await screen.findByTestId('generate-missing-posters'));
      await waitFor(() => expect(screen.getByTestId('poster-run-status').textContent).toBe('Generated 3 of 4 posters. 1 failed.'));
      const failures = screen.getByTestId('poster-run-failures');
      expect(failures.textContent).toContain('Gavotte: This score has a scanned poster');
    });

    it('stops when asked, between scores', async () => {
      api.mockResolvedValue({ ...LIBRARY, scores: [...LIBRARY.scores, ...MISSING] });
      let release;
      engrave.mockImplementationOnce(async (host, xml, opts) => {
        await new Promise((r) => { release = r; });
        if (opts.shouldAbort()) return null;
        host.innerHTML = ENGRAVED;
        return { osmd: {} };
      });
      global.fetch.mockResolvedValue(jsonResponse(201, {}));
      renderLib();
      fireEvent.click(await screen.findByTestId('generate-missing-posters'));
      await waitFor(() => expect(release).toBeTypeOf('function'));
      expect(screen.getByTestId('generate-missing-posters').disabled).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
      release();
      await waitFor(() => expect(screen.getByTestId('poster-run-status').textContent).toBe('Stopped after 0 of 4.'));
      expect(posterCalls()).toHaveLength(0);
      expect(engrave).toHaveBeenCalledTimes(1);
    });

    it('is disabled when every score has a poster', async () => {
      api.mockResolvedValue({ ...LIBRARY, scores: LIBRARY.scores.filter((s) => s.poster !== 'none') });
      renderLib();
      await screen.findByText('Fur Elise');
      const button = screen.getByTestId('generate-missing-posters');
      expect(button.textContent).toBe('Generate missing posters (0)');
      expect(button.disabled).toBe(true);
    });
  });
});
