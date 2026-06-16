import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { getActionBus } from './input/ActionBus.js';
import { ScreenScreensaver } from './ScreenScreensaver.jsx';

const showOverlay = vi.fn();
vi.mock('./overlays/ScreenOverlayProvider.jsx', () => ({
  useScreenOverlay: () => ({ showOverlay, dismissOverlay: () => {}, hasOverlay: false }),
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
  beforeEach(() => { showOverlay.mockReset(); DaylightAPI.mockReset(); });

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
