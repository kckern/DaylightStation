import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import AnnotationPanel from "./AnnotationPanel.jsx";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock("../../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: (...args) => apiMock(...args) }));

describe('AnnotationPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    const notes = [{ id: 'note-1', itemId: 'one', note: 'Remember', quote: 'Quoted', color: 'yellow', updatedAt: '2026-08-24T12:00:00.000Z' }];
    apiMock.mockReset().mockImplementation(async (path, data, method) => {
      if (method === 'POST') {
        const annotation = { ...data, id: 'note-2', updatedAt: '2026-08-24T12:00:00.000Z' };
        notes.push(annotation);
        return { annotation };
      }
      if (method === 'PATCH') {
        notes[0] = { ...notes[0], ...data, updatedAt: '2026-08-24T13:00:00.000Z' };
        return { annotation: notes[0] };
      }
      if (method === 'DELETE') {
        const index = notes.findIndex(note => path.endsWith('/' + note.id));
        notes.splice(index, 1);
        return { removed: true };
      }
      return { annotations: [...notes] };
    });
  });

  test('loads, creates, edits, and deletes notes for an item', async () => {
    render(<AnnotationPanel item={{ id: 'one', title: 'Story' }} />);

    expect(await screen.findByText('Remember')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit note' }), { target: { value: 'Revised' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText('Revised')).toBeInTheDocument());

    fireEvent.change(screen.getByRole('textbox', { name: 'Add a note' }), { target: { value: 'New thought' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(screen.getByText('New thought')).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    await waitFor(() => expect(screen.queryByText('Revised')).not.toBeInTheDocument());
    expect(apiMock).toHaveBeenCalledWith('/api/v1/feed/annotations/note-1', {}, 'DELETE');
  });

  test('opens an edit with the latest saved note and preserves an active draft during refresh', async () => {
    render(<AnnotationPanel item={{ id: 'one' }} />);
    await screen.findByText('Remember');
    const edit = () => fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const editor = () => screen.getByRole('textbox', { name: 'Edit note' });
    edit();
    fireEvent.change(editor(), { target: { value: 'Revision' } });
    const normalized = { id: 'note-1', itemId: 'one', note: 'Normalized revision' };
    apiMock.mockResolvedValueOnce({ annotation: normalized }).mockResolvedValue({ annotations: [normalized] });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(normalized.note);
    edit();
    expect(editor()).toHaveValue(normalized.note);
    fireEvent.change(editor(), { target: { value: 'Unsaved draft' } });
    const next = { ...normalized, note: 'Another revision' };
    apiMock.mockResolvedValue({ annotations: [next] });
    // Saving a second note refreshes the list while the first editor stays open.
    fireEvent.change(screen.getByRole('textbox', { name: 'Add a note' }), { target: { value: 'Another note' } });
    apiMock.mockResolvedValueOnce({ annotation: { id: 'new', itemId: 'one', note: 'Another note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Add a note' })).toHaveValue(''));
    expect(editor()).toHaveValue('Unsaved draft');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText(next.note)).toBeInTheDocument();
  });

  test('captures a contextual text-quote locator from the current article', async () => {
    render(<div className="article-expanded"><p>Before selected passage after.</p><AnnotationPanel item={{ id: 'one', title: 'Story' }} /></div>);
    await screen.findByText('Remember');
    const text = screen.getByText('Before selected passage after.').firstChild;
    const range = document.createRange();
    range.setStart(text, 7);
    range.setEnd(text, 23);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    fireEvent.click(screen.getByRole('button', { name: 'Use selected text' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/api/v1/feed/annotations', expect.objectContaining({
      itemId: 'one',
      quote: 'selected passage',
      locator: expect.stringContaining('TextQuoteSelector'),
    }), 'POST'));
  });

  test('shows online results with blocked storage and retains an offline draft on queue refusal', async () => {
    vi.stubGlobal('localStorage', undefined);
    try {
      render(<AnnotationPanel item={{ id: 'one' }} />);
      expect(await screen.findByText('Remember')).toBeInTheDocument();
      const draft = screen.getByRole('textbox', { name: 'Add a note' });
      fireEvent.change(draft, { target: { value: 'Draft' } });
      apiMock.mockRejectedValue(new TypeError('Failed to fetch'));
      fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved on this device');
      expect(draft).toHaveValue('Draft');
      expect(screen.getAllByRole('article')).toHaveLength(1);
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/api/v1/feed/annotations/note-1', {}, 'DELETE'));
      expect(screen.getByText('Remember')).toBeInTheDocument();
    } finally { vi.unstubAllGlobals(); }
  });

  test.each(['create', 'edit', 'delete'])('shows a queued %s after its submitting panel closed', async action => {
    const item = { id: 'one' };
    const panel = render(<AnnotationPanel item={item} />);
    await screen.findByText('Remember');
    let rejectWrite;
    apiMock.mockImplementationOnce(() => new Promise((_, reject) => { rejectWrite = reject; }));
    if (action === 'create') {
      fireEvent.change(screen.getByRole('textbox', { name: 'Add a note' }), { target: { value: 'Queued note' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    } else if (action === 'edit') {
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Edit note' }), { target: { value: 'Queued note' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    }
    panel.unmount();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    apiMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await act(async () => rejectWrite(new TypeError('Failed to fetch')));
    render(<AnnotationPanel item={item} />);
    await screen.findByRole('textbox', { name: 'Add a note' });
    expect(screen.getByText('1 note change waiting to sync.')).toBeInTheDocument();
    if (action !== 'delete') expect(screen.getByText('Queued note')).toBeInTheDocument();
    if (action !== 'create') expect(screen.queryByText('Remember')).not.toBeInTheDocument();
  });

  test('shows an offline edit from the durable queue when its cache write failed', async () => {
    const write = localStorage.setItem.bind(localStorage);
    const storage = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (key.startsWith('feed:annotation-cache:')) throw new Error('Cache quota');
      write(key, value);
    });
    try {
      const panel = render(<AnnotationPanel item={{ id: 'one' }} />);
      await screen.findByText('Remember');
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Edit note' }), { target: { value: 'Durable edit' } });
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
      apiMock.mockRejectedValue(new TypeError('Failed to fetch'));
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await screen.findByText('1 note change waiting to sync.');
      panel.unmount();
      render(<AnnotationPanel item={{ id: 'one' }} />);
      expect(await screen.findByText('Durable edit')).toBeInTheDocument();
    } finally { storage.mockRestore(); }
  });

  test('reconciles a peer replay completed before the storage notification arrives', async () => {
    render(<AnnotationPanel item={{ id: 'one' }} />);
    await screen.findByText('Remember');
    const key = 'feed:annotation-queue:household';
    localStorage.setItem('feed:annotation-cache:household', JSON.stringify([{ id: 'note-1', itemId: 'one', note: 'Already replayed' }]));
    localStorage.setItem(key, '[]');
    apiMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const event = new Event('storage');
    Object.assign(event, { key, storageArea: localStorage });
    fireEvent(window, event);
    expect(await screen.findByText('Already replayed')).toBeInTheDocument();
  });

  test('discards a late failure after the account changes', async () => {
    const panel = render(<AnnotationPanel item={{ id: 'one' }} />);
    await screen.findByText('Remember');
    let rejectWrite;
    apiMock.mockImplementationOnce(() => new Promise((_, reject) => { rejectWrite = reject; }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    localStorage.setItem('ds_token', 'header.' + btoa(JSON.stringify({ sub: 'next' })) + '.signature');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    apiMock.mockRejectedValue(new TypeError('Failed to fetch'));
    panel.rerender(<AnnotationPanel item={{ id: 'one' }} />);
    await act(async () => rejectWrite(new TypeError('Failed to fetch')));
    await screen.findByRole('textbox', { name: 'Add a note' });
    expect(screen.queryByText(/waiting to sync/)).not.toBeInTheDocument();
    expect(localStorage.getItem('feed:annotation-queue:next')).toBeNull();
    expect(localStorage.getItem('feed:annotation-queue:household')).toBeNull();
  });

  test.each([true, false])('retries a late failure once if a reconnect was observed (%s)', async reconnects => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: !reconnects });
    let rejectPost;
    const writes = [];
    apiMock.mockImplementation(async (_path, data, method) => {
      if (method === 'GET') return { annotations: [] };
      writes.push(method);
      if (writes.length === 1) await new Promise((_, reject) => { rejectPost = reject; });
      throw new TypeError('Still offline');
    });
    const panel = render(<AnnotationPanel item={{ id: 'one' }} />);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Add a note' }), { target: { value: 'Late note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    panel.unmount();
    if (reconnects) {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
      await act(async () => { window.dispatchEvent(new Event('online')); });
    }
    await act(async () => rejectPost(new TypeError('Failed to fetch')));
    expect(writes).toEqual(reconnects ? ['POST', 'POST'] : ['POST']);
    expect(JSON.parse(localStorage.getItem('feed:annotation-queue:household'))).toHaveLength(1);
  });

  test('orders an edit made while its offline creation is replaying', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    apiMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<AnnotationPanel item={{ id: 'one' }} />);
    const draft = await screen.findByRole('textbox', { name: 'Add a note' });
    fireEvent.change(draft, { target: { value: 'Offline note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await screen.findByText('Offline note');
    let finishCreate;
    let saved;
    const writes = [];
    let finishRead;
    apiMock.mockImplementation(async (_path, data, method) => {
      if (method === 'GET') {
        await new Promise(resolve => { finishRead = resolve; });
        return { annotations: [saved] };
      }
      writes.push(method);
      if (method === 'POST') await new Promise(resolve => { finishCreate = resolve; });
      saved = { ...saved, ...data, updatedAt: '2026-08-24T12:00:00Z' };
      return { annotation: saved };
    });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    fireEvent(window, new Event('online'));
    await waitFor(() => expect(writes).toEqual(['POST']));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit note' }), { target: { value: 'Later edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('2 note changes waiting to sync.');
    expect(writes).toEqual(['POST']);
    await act(async () => finishCreate());
    await waitFor(() => expect(screen.queryByText(/waiting to sync/)).not.toBeInTheDocument());
    expect(screen.getByText('Later edit')).toBeInTheDocument();
    expect(writes).toEqual(['POST', 'PATCH']);
    await act(async () => finishRead());
  });

  test('keeps notes available and queues creation when the browser is offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    apiMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<AnnotationPanel item={{ id: 'one', stateKey: 'one', title: 'Story' }} />);

    await screen.findByText('Showing notes saved on this device.');
    fireEvent.change(screen.getByRole('textbox', { name: 'Add a note' }), { target: { value: 'Offline thought' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));

    expect(await screen.findByText('1 note change waiting to sync.')).toBeInTheDocument();
    expect(screen.getByText('Offline thought')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('feed:annotation-queue:household'))).toMatchObject([{ method: 'POST', data: { itemId: 'one', note: 'Offline thought' } }]);
  });
});
