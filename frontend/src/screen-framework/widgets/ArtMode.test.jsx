import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, act, fireEvent } from '@testing-library/react';
import { DaylightAPI } from '../../lib/api.mjs';
import ArtMode from './ArtMode.jsx';

const press = (key) =>
  act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
const pressShift = (key) =>
  act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey: true, bubbles: true, cancelable: true })); });

vi.mock('../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(),
  DaylightMediaPath: (p) => String(p),
}));

let ambientCb = null;
vi.mock('../../hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: (_filter, cb) => { ambientCb = cb; },
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

  it('holds the curtain down for the minimum even on a fast load', async () => {
    DaylightAPI.mockResolvedValue(single());
    const { getByTestId } = render(<ArtMode curtainMinMs={800} curtainMaxMs={5000} />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    fireEvent.load(getByTestId('artmode-image'));
    // Image is loaded, but the curtain must NOT have parted yet (min dwell pending).
    expect(getByTestId('artmode-curtain').className).not.toContain('artmode__curtain--open');
    // It parts once the minimum elapses.
    await waitFor(
      () => expect(getByTestId('artmode-curtain').className).toContain('artmode__curtain--open'),
      { timeout: 1500 });
  });

  it('parts the curtain by the maximum even if assets never load', async () => {
    DaylightAPI.mockResolvedValue(single());   // resolves, but the image load never fires
    const { getByTestId } = render(<ArtMode curtainMaxMs={300} />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    // No fireEvent.load — only the safety rail can open it.
    await waitFor(
      () => expect(getByTestId('artmode-curtain').className).toContain('artmode__curtain--open'),
      { timeout: 1200 });
  });

  it('auto-dims from an ambient lux message via the curve', async () => {
    ambientCb = null;
    DaylightAPI.mockResolvedValue(single());
    const ambient = { defaultLux: 80, curve: [{ lux: 0, dim: 0.9 }, { lux: 100, dim: 0.2 }] };
    const { getByTestId } = render(<ArtMode ambient={ambient} />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    act(() => ambientCb({ lux: 0 }));   // dark room → 0.9 clamped to 0.85 ceiling
    expect(getByTestId('artmode-dim').style.opacity).toBe('0.85');
    act(() => ambientCb({ lux: 100 })); // bright → 0.2
    expect(getByTestId('artmode-dim').style.opacity).toBe('0.2');
  });

  it('manual Up/Down biases the auto level', async () => {
    ambientCb = null;
    DaylightAPI.mockResolvedValue(single());
    const ambient = { defaultLux: 80, curve: [{ lux: 0, dim: 0.9 }, { lux: 100, dim: 0.2 }] };
    const { getByTestId } = render(<ArtMode ambient={ambient} />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    act(() => ambientCb({ lux: 100 }));   // auto 0.2
    press('ArrowDown');                    // +0.1 bias → 0.3
    expect(getByTestId('artmode-dim').style.opacity).toBe('0.3');
    press('ArrowUp'); press('ArrowUp');    // -0.2 → 0.1
    expect(getByTestId('artmode-dim').style.opacity).toBe('0.1');
  });

  it('Tab cycles view modes (wraps); Shift+Tab reverses', async () => {
    DaylightAPI.mockResolvedValue(single());
    const { getByTestId } = render(<ArtMode />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    const modeOf = () => getByTestId('artmode').getAttribute('data-mode');
    expect(modeOf()).toBe('gallery');
    press('Tab'); expect(modeOf()).toBe('framed-contain');
    press('Tab'); expect(modeOf()).toBe('framed-cover');
    press('Tab'); expect(modeOf()).toBe('bare-contain');
    press('Tab'); expect(modeOf()).toBe('bare-cover');
    press('Tab'); expect(modeOf()).toBe('gallery');         // wrap forward
    pressShift('Tab'); expect(modeOf()).toBe('bare-cover');  // reverse wrap
  });

  it('hides the frame in bare modes, shows it in framed modes', async () => {
    DaylightAPI.mockResolvedValue(single());
    const { getByTestId, queryByTestId } = render(<ArtMode />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    expect(getByTestId('artmode-frame')).toBeTruthy();          // gallery
    press('Tab'); press('Tab'); press('Tab');                   // bare-contain
    expect(queryByTestId('artmode-frame')).toBeNull();
  });

  it('hides placards in bare modes', async () => {
    DaylightAPI.mockResolvedValue(single());
    const { getByTestId, queryByTestId } = render(<ArtMode />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    expect(getByTestId('artmode-placard')).toBeTruthy();
    press('Tab'); press('Tab'); press('Tab'); press('Tab');     // bare-cover
    expect(queryByTestId('artmode-placard')).toBeNull();
  });

  it('applies object-fit per mode (contain then cover)', async () => {
    DaylightAPI.mockResolvedValue(single());
    const { getByTestId } = render(<ArtMode />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    press('Tab');  // framed-contain
    expect(getByTestId('artmode-image').className).toContain('artmode__fitimage--contain');
    press('Tab');  // framed-cover
    expect(getByTestId('artmode-image').className).toContain('artmode__fitimage--cover');
  });

  it('keeps diptych two-up in object-fit modes', async () => {
    DaylightAPI.mockResolvedValue(diptych());
    const { getByTestId } = render(<ArtMode />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    press('Tab');  // framed-contain
    expect(getByTestId('artmode-image')).toBeTruthy();
    expect(getByTestId('artmode-image-1')).toBeTruthy();
  });

  it('preserves the mode across a shuffle', async () => {
    DaylightAPI.mockResolvedValue(single());
    const { getByTestId } = render(<ArtMode />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    press('Tab'); press('Tab');  // framed-cover
    expect(getByTestId('artmode').getAttribute('data-mode')).toBe('framed-cover');
    press('ArrowRight');         // shuffle
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalledTimes(2));
    expect(getByTestId('artmode').getAttribute('data-mode')).toBe('framed-cover');
  });

  it('Tab is preventDefaulted (kiosk focus never moves)', async () => {
    DaylightAPI.mockResolvedValue(single());
    const { getByTestId } = render(<ArtMode />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => { window.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(true);
  });

  it('placard max-width tracks the panel width', async () => {
    DaylightAPI.mockResolvedValue(single());
    const { getByTestId } = render(<ArtMode />);
    await waitFor(() => expect(getByTestId('artmode-placard')).toBeTruthy());
    const mw = getByTestId('artmode-placard').style.maxWidth;
    expect(mw).toMatch(/%$/);
    const pct = parseFloat(mw);
    expect(pct).toBeGreaterThan(40);          // a real artwork width, not zero
    expect(pct).toBeLessThanOrEqual(100);
  });

  it('parts the curtain after the artwork loads in an object-fit mode', async () => {
    DaylightAPI.mockResolvedValue(single());
    const { getByTestId } = render(<ArtMode />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    press('Tab');  // framed-contain → object-fit render path
    expect(getByTestId('artmode-curtain').className).not.toContain('artmode__curtain--open');
    fireEvent.load(getByTestId('artmode-image'));
    await waitFor(() =>
      expect(getByTestId('artmode-curtain').className).toContain('artmode__curtain--open'));
  });

  it('splits a long title into two balanced placard lines', async () => {
    DaylightAPI.mockResolvedValue(single({
      panels: [{ image: '/a.jpg', meta: { title: 'one two three four', artist: 'X', date: '1', width: 1600, height: 1000 } }],
    }));
    const measureText = (s) => s.length * 1000;  // force a split
    const { getByTestId, container } = render(<ArtMode measureText={measureText} />);
    await waitFor(() => expect(getByTestId('artmode-placard')).toBeTruthy());
    expect(container.querySelectorAll('.artmode__placard-title').length).toBe(2);
  });

  it('renders a background-audio element only when music config is present', async () => {
    DaylightAPI.mockResolvedValue(single());
    const { getByTestId, queryByTestId } = render(<ArtMode />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    expect(queryByTestId('artmode-music')).toBeNull();
  });

  it('shows the music plaque with the current track in framed modes', async () => {
    DaylightAPI.mockImplementation((path) =>
      path.startsWith('api/v1/queue/')
        ? Promise.resolve({ items: [{ mediaUrl: 'a.mp3', title: 'Gymnopédie', artist: 'Satie' }] })
        : Promise.resolve(single()));
    const { getByTestId } = render(<ArtMode music={{ queue: 'ambient', volume: 0.2 }} />);
    await waitFor(() => expect(getByTestId('artmode-music')).toBeTruthy());
    await waitFor(() => expect(getByTestId('artmode-music-plaque')).toBeTruthy());
    const txt = getByTestId('artmode-music-plaque').textContent;
    expect(txt).toContain('Gymnopédie');
    expect(txt).toContain('Satie');
  });

  it('hides the music plaque in bare modes but keeps the audio element', async () => {
    DaylightAPI.mockImplementation((path) =>
      path.startsWith('api/v1/queue/')
        ? Promise.resolve({ items: [{ mediaUrl: 'a.mp3', title: 'A', artist: 'X' }] })
        : Promise.resolve(single()));
    const { getByTestId, queryByTestId } = render(<ArtMode music={{ queue: 'ambient' }} />);
    await waitFor(() => expect(getByTestId('artmode-music-plaque')).toBeTruthy());
    press('Tab'); press('Tab'); press('Tab'); press('Tab');  // bare-cover
    expect(queryByTestId('artmode-music-plaque')).toBeNull();
    expect(getByTestId('artmode-music')).toBeTruthy();        // audio still mounted
  });

  it('requests the configured collection from the art API', async () => {
    DaylightAPI.mockResolvedValue(single());
    render(<ArtMode collection="baroque" />);
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalledWith('api/v1/art/featured?collection=baroque'));
  });

  it('requests the default endpoint when no collection is set', async () => {
    DaylightAPI.mockResolvedValue(single());
    render(<ArtMode />);
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalledWith('api/v1/art/featured'));
  });
});
