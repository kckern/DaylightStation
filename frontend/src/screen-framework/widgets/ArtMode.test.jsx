import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, act, fireEvent } from '@testing-library/react';
import { DaylightAPI } from '../../lib/api.mjs';
import ArtMode from './ArtMode.jsx';

const press = (key) =>
  act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });

vi.mock('../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(),
  DaylightMediaPath: (p) => String(p),
}));

const matte = {
  branch: 'match', base: '#58616b', glow: '#6b7682', edge: '#474e56',
  bevelTop: '#474e56', bevelLeft: '#4e555d', bevelRight: '#626c77', bevelBottom: '#6b7682',
};
const single = (over = {}) => ({
  mode: 'single', matte,
  panels: [{ image: '/a.jpg', meta: { title: 'A', artist: 'Artist', date: '1900', width: 1600, height: 1000 } }],
  ...over,
});
const diptych = () => ({
  mode: 'diptych', matte,
  panels: [
    { image: '/a.jpg', meta: { title: 'A', artist: 'X', date: '1', width: 800, height: 1200 } },
    { image: '/b.jpg', meta: { title: 'B', artist: 'X', date: '2', width: 800, height: 1100 } },
  ],
});

describe('ArtMode', () => {
  beforeEach(() => { DaylightAPI.mockReset(); });

  it('single: one window, one placard, frame, matte vars', async () => {
    DaylightAPI.mockResolvedValue(single());
    const { getByTestId, queryByTestId } = render(<ArtMode />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    expect(getByTestId('artmode-frame')).toBeTruthy();
    expect(getByTestId('artmode-placard')).toBeTruthy();
    expect(queryByTestId('artmode-image-1')).toBeNull();
    expect(getByTestId('artmode').style.getPropertyValue('--matte-base')).toBe('#58616b');
  });

  it('diptych: two windows and two placards', async () => {
    DaylightAPI.mockResolvedValue(diptych());
    const { getByTestId } = render(<ArtMode />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    expect(getByTestId('artmode-image-1')).toBeTruthy();
    expect(getByTestId('artmode-placard')).toBeTruthy();
    expect(getByTestId('artmode-placard-1')).toBeTruthy();
  });

  it('hides placards when placard=false', async () => {
    DaylightAPI.mockResolvedValue(single());
    const { getByTestId, queryByTestId } = render(<ArtMode placard={false} />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    expect(queryByTestId('artmode-placard')).toBeNull();
  });

  it('black fallback (no image) on fetch failure', async () => {
    DaylightAPI.mockRejectedValue(new Error('boom'));
    const { getByTestId, queryByTestId } = render(<ArtMode />);
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalled());
    await waitFor(() => expect(getByTestId('artmode-frame')).toBeTruthy());
    expect(queryByTestId('artmode-image')).toBeNull();
  });

  it('shuffles on arrows; exits on Enter/Space/Escape; dims on Up/Down', async () => {
    DaylightAPI.mockResolvedValue(single());
    const onExit = vi.fn();
    const { getByTestId } = render(<ArtMode onExit={onExit} />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    expect(DaylightAPI).toHaveBeenCalledTimes(1);
    press('ArrowRight');
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalledTimes(2));
    expect(getByTestId('artmode-dim').style.opacity).toBe('0');
    press('ArrowDown');
    expect(getByTestId('artmode-dim').style.opacity).toBe('0.1');
    press('ArrowUp');
    expect(getByTestId('artmode-dim').style.opacity).toBe('0');
    press('Enter'); press(' '); press('Escape');
    expect(onExit).toHaveBeenCalledTimes(3);
  });

  it('smart-quotes the title (curly apostrophe via library)', async () => {
    DaylightAPI.mockResolvedValue(single({
      panels: [{ image: '/a.jpg', meta: { title: "Falaise d'Amont", artist: 'Monet', date: '1885', width: 1600, height: 1000 } }],
    }));
    const { getByTestId } = render(<ArtMode />);
    await waitFor(() => expect(getByTestId('artmode-placard')).toBeTruthy());
    expect(getByTestId('artmode-placard').textContent).toContain('d’Amont');
    expect(getByTestId('artmode-placard').textContent).not.toContain("d'Amont");
  });

  it('curtain is down until the artwork loads, then parts', async () => {
    DaylightAPI.mockResolvedValue(single());
    const { getByTestId } = render(<ArtMode />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    expect(getByTestId('artmode-curtain').className).not.toContain('artmode__curtain--open');
    fireEvent.load(getByTestId('artmode-image'));
    await waitFor(() =>
      expect(getByTestId('artmode-curtain').className).toContain('artmode__curtain--open'));
  });
});
