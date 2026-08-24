import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import AnnotationPanel from './AnnotationPanel.jsx';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...args) => apiMock(...args) }));

describe('AnnotationPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    apiMock.mockReset().mockImplementation((path, data, method) => {
      if (method === 'POST') return Promise.resolve({ annotation: { id: 'note-2', itemId: 'one', note: data.note, quote: data.quote, color: data.color, locator: data.locator, updatedAt: '2026-08-24T12:00:00.000Z' } });
      if (method === 'PATCH') return Promise.resolve({ annotation: { id: 'note-1', itemId: 'one', note: data.note, quote: 'Quoted', color: 'yellow', updatedAt: '2026-08-24T13:00:00.000Z' } });
      if (method === 'DELETE') return Promise.resolve({ removed: true });
      return Promise.resolve({ annotations: [{ id: 'note-1', itemId: 'one', note: 'Remember', quote: 'Quoted', color: 'yellow', updatedAt: '2026-08-24T12:00:00.000Z' }] });
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
