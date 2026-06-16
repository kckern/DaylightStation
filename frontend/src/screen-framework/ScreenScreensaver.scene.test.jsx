import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { getActionBus } from './input/ActionBus.js';
import { ScreenScreensaver } from './ScreenScreensaver.jsx';

const showOverlay = vi.fn();
const dismissOverlay = vi.fn();
vi.mock('./overlays/ScreenOverlayProvider.jsx', () => ({
  useScreenOverlay: () => ({ showOverlay, dismissOverlay, hasOverlay: false }),
}));
vi.mock('../context/MenuNavigationContext.jsx', () => ({
  useMenuNavigationContext: () => ({ reset: () => {} }),
}));
const Stub = () => null;
vi.mock('./widgets/registry.js', () => ({
  getWidgetRegistry: () => ({ get: () => Stub }),
}));
import { DaylightAPI } from '../lib/api.mjs';
vi.mock('../lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));

const cfg = { widget: 'art', idle: 0, showOnLoad: false, interactive: true };

describe('ScreenScreensaver scene trigger', () => {
  beforeEach(() => { showOverlay.mockReset(); dismissOverlay.mockReset(); DaylightAPI.mockReset(); });

  it('engages the ArtMode scene from a display:content art: event', async () => {
    DaylightAPI.mockResolvedValue({ collection: 'all', music: { queue: 'plex:1' } });
    render(<ScreenScreensaver config={cfg} />);
    act(() => { getActionBus().emit('display:content', { id: 'art:classical-evening' }); });
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalledWith('api/v1/art/preset/classical-evening'));
    await waitFor(() => expect(showOverlay).toHaveBeenCalled());
    const lastCall = showOverlay.mock.calls[showOverlay.mock.calls.length - 1];
    const [, props, opts] = lastCall;
    expect(props.collection).toBe('all');
    expect(props.music).toEqual({ queue: 'plex:1' });
    expect(typeof props.onExit).toBe('function');
    expect(opts).toMatchObject({ mode: 'fullscreen', priority: 'high' });
  });

  it('a dispatched scene replaces the default (priority high) and onExit resumes it', async () => {
    DaylightAPI.mockResolvedValue({ collection: 'baroque', music: null });
    render(<ScreenScreensaver config={{ widget: 'art', idle: 60, showOnLoad: true, interactive: true }} />);
    // Default shows on load with no priority.
    await waitFor(() => expect(showOverlay).toHaveBeenCalled());
    expect(showOverlay.mock.calls[0][2].priority).toBeUndefined();
    // Dispatch a scene → second show with priority:'high' + the fetched props.
    act(() => { getActionBus().emit('display:content', { id: 'art:baroque-quiet' }); });
    await waitFor(() => expect(showOverlay.mock.calls.length).toBeGreaterThanOrEqual(2));
    const sceneCall = showOverlay.mock.calls[showOverlay.mock.calls.length - 1];
    expect(sceneCall[2]).toMatchObject({ priority: 'high' });
    expect(sceneCall[1].collection).toBe('baroque');
    // onExit resumes the default (dismiss + reschedule).
    act(() => { sceneCall[1].onExit(); });
    expect(dismissOverlay).toHaveBeenCalledWith('fullscreen');
  });

  it('ignores non-art display:content ids', async () => {
    render(<ScreenScreensaver config={cfg} />);
    act(() => { getActionBus().emit('display:content', { id: 'immich:abc' }); });
    await Promise.resolve();
    expect(DaylightAPI).not.toHaveBeenCalled();
  });

  it('does not engage when the preset fetch fails (404)', async () => {
    DaylightAPI.mockRejectedValue(new Error('HTTP 404'));
    render(<ScreenScreensaver config={cfg} />);
    act(() => { getActionBus().emit('display:content', { id: 'art:nope' }); });
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalled());
    expect(showOverlay).not.toHaveBeenCalled();
  });
});
