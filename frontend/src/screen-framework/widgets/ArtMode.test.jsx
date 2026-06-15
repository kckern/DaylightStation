import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { DaylightAPI } from '../../lib/api.mjs';
import ArtMode from './ArtMode.jsx';

const press = (key) =>
  act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });

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

  it('shuffles to a new random painting on left/right arrows', async () => {
    DaylightAPI.mockResolvedValue({ image: '/x.jpg', meta: { title: 'T', artist: 'A', date: '1' } });
    const { getByTestId } = render(<ArtMode />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    expect(DaylightAPI).toHaveBeenCalledTimes(1);

    press('ArrowRight');
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalledTimes(2));
    press('ArrowLeft');
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalledTimes(3));
  });

  it('dims on ArrowDown and brightens on ArrowUp', async () => {
    DaylightAPI.mockResolvedValue({ image: '/x.jpg', meta: { title: 'T', artist: 'A', date: '1' } });
    const { getByTestId } = render(<ArtMode />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());

    expect(getByTestId('artmode-dim').style.opacity).toBe('0');
    press('ArrowDown');
    expect(getByTestId('artmode-dim').style.opacity).toBe('0.1');
    press('ArrowDown');
    expect(getByTestId('artmode-dim').style.opacity).toBe('0.2');
    press('ArrowUp');
    expect(getByTestId('artmode-dim').style.opacity).toBe('0.1');
  });

  it('calls onExit on Enter, Space, and Escape', async () => {
    DaylightAPI.mockResolvedValue({ image: '/x.jpg', meta: { title: 'T', artist: 'A', date: '1' } });
    const onExit = vi.fn();
    const { getByTestId } = render(<ArtMode onExit={onExit} />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());

    press('Enter');
    press(' ');
    press('Escape');
    expect(onExit).toHaveBeenCalledTimes(3);
  });

  it('does not exit on arrow keys', async () => {
    DaylightAPI.mockResolvedValue({ image: '/x.jpg', meta: { title: 'T', artist: 'A', date: '1' } });
    const onExit = vi.fn();
    const { getByTestId } = render(<ArtMode onExit={onExit} />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());

    press('ArrowLeft');
    press('ArrowUp');
    press('ArrowDown');
    expect(onExit).not.toHaveBeenCalled();
  });

  it('applies the matte palette as CSS custom properties', async () => {
    DaylightAPI.mockResolvedValue({
      image: '/x.jpg',
      meta: { title: 'T', artist: 'A', date: '1' },
      color: { average: '#75879c', hue: 212, saturation: 0.25, value: 0.61 },
      matte: {
        branch: 'match', base: '#58616b', glow: '#6b7682', edge: '#474e56',
        bevelTop: '#474e56', bevelLeft: '#4e555d', bevelRight: '#626c77', bevelBottom: '#6b7682',
      },
    });
    const { getByTestId } = render(<ArtMode />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    const root = getByTestId('artmode');
    expect(root.style.getPropertyValue('--matte-base')).toBe('#58616b');
    expect(root.style.getPropertyValue('--cut-top')).toBe('#474e56');
    expect(root.style.getPropertyValue('--cut-bottom')).toBe('#6b7682');
  });

  it('sets no matte custom properties when matte is absent', async () => {
    DaylightAPI.mockResolvedValue({ image: '/x.jpg', meta: { title: 'T', artist: 'A', date: '1' } });
    const { getByTestId } = render(<ArtMode />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    expect(getByTestId('artmode').style.getPropertyValue('--matte-base')).toBe('');
  });
});
