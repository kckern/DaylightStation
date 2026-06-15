import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { DaylightAPI } from '../../lib/api.mjs';
import ArtMode from './ArtMode.jsx';

vi.mock('../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(),
  DaylightMediaPath: (p) => String(p),
}));

describe('ArtMode', () => {
  beforeEach(() => {
    DaylightAPI.mockReset();
  });

  it('renders the painting and the frame overlay', async () => {
    DaylightAPI.mockResolvedValue({
      image: '/media/img/art/classic/Folder/Painting.jpg',
      meta: { title: 'Painting', artist: 'Someone', date: '1674', origin: 'Holland', medium: 'Oil' },
    });
    const { getByTestId } = render(<ArtMode />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    expect(getByTestId('artmode-image').getAttribute('src')).toBe('/media/img/art/classic/Folder/Painting.jpg');
    expect(getByTestId('artmode-frame')).toBeTruthy();
  });

  it('shows the placard with title/artist/year by default', async () => {
    DaylightAPI.mockResolvedValue({
      image: '/x.jpg',
      meta: { title: 'Painting', artist: 'Someone', date: '1674', origin: null, medium: null },
    });
    const { getByTestId } = render(<ArtMode />);
    await waitFor(() => expect(getByTestId('artmode-placard')).toBeTruthy());
    expect(getByTestId('artmode-placard').textContent).toContain('Painting');
    expect(getByTestId('artmode-placard').textContent).toContain('Someone');
    expect(getByTestId('artmode-placard').textContent).toContain('1674');
  });

  it('hides the placard when placard=false', async () => {
    DaylightAPI.mockResolvedValue({ image: '/x.jpg', meta: { title: 'T', artist: 'A', date: '1' } });
    const { queryByTestId, getByTestId } = render(<ArtMode placard={false} />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    expect(queryByTestId('artmode-placard')).toBeNull();
  });

  it('renders a black fallback (no image) when the fetch fails', async () => {
    DaylightAPI.mockRejectedValue(new Error('boom'));
    const { queryByTestId, getByTestId } = render(<ArtMode />);
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalled());
    // let the rejected promise + state update flush
    await waitFor(() => expect(getByTestId('artmode-frame')).toBeTruthy());
    expect(queryByTestId('artmode-image')).toBeNull();
  });
});
