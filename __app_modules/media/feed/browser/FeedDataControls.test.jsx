import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import FeedDataControls from "./FeedDataControls.jsx";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock("../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: (...args) => apiMock(...args) }));

describe('FeedDataControls', () => {
  beforeEach(() => apiMock.mockReset());

  test('imports a portable Feed export and reports exact counts', async () => {
    apiMock.mockResolvedValue({ imported: { items: 3, states: 2, annotations: 1 } });
    const onImported = vi.fn();
    render(<FeedDataControls onImported={onImported} />);
    const file = new File([JSON.stringify({ format: 'daylight.feed-export/v1' })], 'feed.json', { type: 'application/json' });

    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });

    expect(await screen.findByText('Imported 3 items, 2 states, and 1 note.')).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith('/api/v1/feed/data/import', { format: 'daylight.feed-export/v1' }, 'POST');
    expect(onImported).toHaveBeenCalledOnce();
  });

  test('allows an admitted import to finish without refreshing the retired view', async () => {
    const importRequest = Promise.withResolvers();
    apiMock.mockReturnValue(importRequest.promise);
    const onImported = vi.fn();
    const view = render(<FeedDataControls onImported={onImported} />);
    const file = new File([JSON.stringify({ format: 'daylight.feed-export/v1' })], 'feed.json', { type: 'application/json' });

    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/feed/data/import', { format: 'daylight.feed-export/v1' }, 'POST',
    ));
    view.unmount();
    await act(async () => importRequest.resolve({ imported: { items: 1 } }));
    expect(apiMock).toHaveBeenCalledOnce();
    expect(onImported).not.toHaveBeenCalled();
  });

  test('rejects malformed JSON before calling the API', async () => {
    render(<FeedDataControls />);
    const file = new File(['not json'], 'bad.json', { type: 'application/json' });
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText('That file is not valid JSON.')).toBeInTheDocument());
    expect(apiMock).not.toHaveBeenCalled();
  });
});
