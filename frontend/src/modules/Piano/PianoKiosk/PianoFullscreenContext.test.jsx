import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  FULLSCREEN_STORAGE_KEY,
  PianoFullscreenProvider,
  readFullscreen,
  useBoardGameFullscreen,
  usePianoFullscreen,
  useHostedFullscreenToggle,
  writeFullscreen,
} from './PianoFullscreenContext.jsx';
import PianoFullscreenToggle from './PianoFullscreenToggle.jsx';

const memoryStore = (initial = {}) => {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: (key) => { delete data[key]; },
  };
};

const throwingStore = {
  getItem: () => { throw new Error('blocked'); },
  setItem: () => { throw new Error('blocked'); },
  removeItem: () => { throw new Error('blocked'); },
};

const withProvider = (store) => {
  function FullscreenWrapper({ children }) {
    return <PianoFullscreenProvider storage={store}>{children}</PianoFullscreenProvider>;
  }
  return FullscreenWrapper;
};

describe('fullscreen storage', () => {
  it('round-trips through the store and clears rather than storing false', () => {
    const store = memoryStore();
    expect(readFullscreen(store)).toBe(false);
    writeFullscreen(true, store);
    expect(store.data[FULLSCREEN_STORAGE_KEY]).toBe('true');
    expect(readFullscreen(store)).toBe(true);
    writeFullscreen(false, store);
    expect(FULLSCREEN_STORAGE_KEY in store.data).toBe(false);
  });

  it('never throws on a blocked store', () => {
    expect(readFullscreen(throwingStore)).toBe(false);
    expect(() => writeFullscreen(true, throwingStore)).not.toThrow();
  });
});

describe('PianoFullscreenProvider', () => {
  it('is unavailable outside the kiosk, and the toggle draws nothing there', () => {
    const { result } = renderHook(() => usePianoFullscreen());
    expect(result.current.available).toBe(false);
    expect(result.current.fullscreen).toBe(false);
    const { container } = render(<PianoFullscreenToggle />);
    expect(container.innerHTML).toBe('');
  });

  it('restores the remembered state and remembers each change', () => {
    const store = memoryStore({ [FULLSCREEN_STORAGE_KEY]: 'true' });
    const { result } = renderHook(() => usePianoFullscreen(), { wrapper: withProvider(store) });
    expect(result.current.fullscreen).toBe(true);
    act(() => result.current.toggle('test'));
    expect(result.current.fullscreen).toBe(false);
    expect(readFullscreen(store)).toBe(false);
    act(() => result.current.setFullscreen(true, 'test'));
    expect(readFullscreen(store)).toBe(true);
  });

  it('keeps one accessible name and reports the state as pressed', () => {
    render(<PianoFullscreenToggle />, { wrapper: withProvider(memoryStore()) });
    const button = screen.getByRole('button', { name: 'Full screen' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(button);
    expect(screen.getByRole('button', { name: 'Full screen' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('counts surfaces hosting the toggle for exactly as long as they host it', () => {
    const store = memoryStore();
    const { result, rerender, unmount } = renderHook(
      ({ enabled }) => ({ drawn: useHostedFullscreenToggle(enabled), ctx: usePianoFullscreen() }),
      { wrapper: withProvider(store), initialProps: { enabled: true } },
    );
    expect(result.current.drawn).toBe(true);
    expect(result.current.ctx.hosted).toBe(true);
    rerender({ enabled: false });
    expect(result.current.drawn).toBe(false);
    expect(result.current.ctx.hosted).toBe(false);
    unmount();
  });

  it('never claims to host outside the kiosk', () => {
    const { result } = renderHook(() => useHostedFullscreenToggle(true));
    expect(result.current).toBe(false);
  });
});

describe('board-game full screen', () => {
  const useBoard = ({ gameId, mounted = true, enter = true }) => {
    useBoardGameFullscreen(mounted ? gameId : null, { enter });
    return usePianoFullscreen();
  };

  it('enters full screen on arrival without touching the remembered kiosk state', () => {
    const store = memoryStore();
    const { result, rerender } = renderHook(useBoard, {
      wrapper: withProvider(store), initialProps: { gameId: 'chess' },
    });
    expect(result.current.fullscreen).toBe(true);
    expect(result.current.mode).toBe('board-game');
    expect(result.current.surface).toBe('chess');
    expect(readFullscreen(store)).toBe(false);

    rerender({ gameId: 'chess', mounted: false });
    expect(result.current.fullscreen).toBe(false);
    expect(result.current.mode).toBe('kiosk');
  });

  it('lets the player step out, and never writes that choice to the device', () => {
    const store = memoryStore({ [FULLSCREEN_STORAGE_KEY]: 'true' });
    const { result, rerender } = renderHook(useBoard, {
      wrapper: withProvider(store), initialProps: { gameId: 'checkers' },
    });
    act(() => result.current.toggle('test'));
    expect(result.current.fullscreen).toBe(false);
    expect(readFullscreen(store)).toBe(true);

    // Leaving the game hands the kiosk's own answer back.
    rerender({ gameId: 'checkers', mounted: false });
    expect(result.current.fullscreen).toBe(true);
  });

  it('keeps the choice across a rematch remount, but not for a different game', () => {
    const store = memoryStore();
    const { result, rerender } = renderHook(useBoard, {
      wrapper: withProvider(store), initialProps: { gameId: 'chess' },
    });
    act(() => result.current.toggle('test'));
    rerender({ gameId: 'chess', mounted: false });
    rerender({ gameId: 'chess' });
    expect(result.current.fullscreen).toBe(false);

    rerender({ gameId: 'chess', mounted: false });
    rerender({ gameId: 'connect-four' });
    expect(result.current.fullscreen).toBe(true);
  });

  it('arrives windowed when the household turns entering off', () => {
    const { result } = renderHook(useBoard, {
      wrapper: withProvider(memoryStore()), initialProps: { gameId: 'chess', enter: false },
    });
    expect(result.current.mode).toBe('board-game');
    expect(result.current.fullscreen).toBe(false);
  });

  it('is inert outside the kiosk', () => {
    const { result } = renderHook(useBoard, { initialProps: { gameId: 'chess' } });
    expect(result.current.fullscreen).toBe(false);
    expect(result.current.available).toBe(false);
  });
});
