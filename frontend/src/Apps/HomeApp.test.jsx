import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

// The camera surface (snapshot/HLS/detections) has its own tests — HomeApp's
// job is data-state wiring (loading/error/empty/grid), so stub the feed.
vi.mock('../modules/CameraFeed/CameraFeed.jsx', () => ({
  default: ({ cameraId, renderHeader }) => (
    <div data-testid={`camera-${cameraId}`}>
      {renderHeader?.(() => {})}
      mock-feed-{cameraId}
    </div>
  ),
}));

import HomeApp from './HomeApp.jsx';

describe('HomeApp — data-state rendering', () => {
  beforeEach(() => { apiMock.mockReset(); });

  it('shows a loading skeleton while cameras are in flight', async () => {
    apiMock.mockImplementation(() => new Promise(() => {})); // never resolves
    render(<HomeApp />);
    expect(screen.getByRole('heading', { name: 'Home' })).toBeTruthy();
    expect(document.querySelector('.ds-state--loading')).toBeTruthy();
  });

  it('shows ErrorState with a working retry on fetch failure', async () => {
    apiMock.mockRejectedValue(new Error('camera api down'));
    render(<HomeApp />);
    await waitFor(() => expect(screen.getByText(/camera api down/)).toBeTruthy());

    apiMock.mockResolvedValueOnce({ cameras: [{ id: 'doorbell' }] });
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(screen.getByTestId('camera-doorbell')).toBeTruthy());
  });

  it('shows EmptyState when no cameras are configured', async () => {
    apiMock.mockResolvedValue({ cameras: [] });
    render(<HomeApp />);
    await waitFor(() => expect(screen.getByText('No cameras configured')).toBeTruthy());
  });

  it('renders the camera grid with doorbell first, then alphabetical', async () => {
    apiMock.mockResolvedValue({
      cameras: [{ id: 'backyard' }, { id: 'doorbell' }, { id: 'garage' }],
    });
    render(<HomeApp />);
    await waitFor(() => expect(screen.getByTestId('camera-doorbell')).toBeTruthy());

    const cards = screen.getAllByText(/^doorbell$|^backyard$|^garage$/);
    expect(cards.map((el) => el.textContent)).toEqual(['doorbell', 'backyard', 'garage']);
  });
});
