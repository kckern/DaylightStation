import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import FeedDataControls from './FeedDataControls.jsx';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../../lib/api.mjs', () => ({ DaylightAPI: (...args) => apiMock(...args) }));

describe('FeedDataControls', () => {
  beforeEach(() => apiMock.mockReset());

  test('imports a portable Feed export and reports exact counts', async () => {
    apiMock.mockResolvedValue({ imported: { items: 3, states: 2, annotations: 1 } });
    render(<FeedDataControls />);
    const file = new File([JSON.stringify({ format: 'daylight.feed-export/v1' })], 'feed.json', { type: 'application/json' });

    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });

    expect(await screen.findByText('Imported 3 items, 2 states, and 1 note.')).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith('/api/v1/feed/data/import', { format: 'daylight.feed-export/v1' }, 'POST');
  });

  test('rejects malformed JSON before calling the API', async () => {
    render(<FeedDataControls />);
    const file = new File(['not json'], 'bad.json', { type: 'application/json' });
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText('That file is not valid JSON.')).toBeInTheDocument());
    expect(apiMock).not.toHaveBeenCalled();
  });
});
