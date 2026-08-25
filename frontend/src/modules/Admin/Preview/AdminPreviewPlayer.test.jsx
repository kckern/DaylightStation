// AdminPreviewPlayer.test.jsx — pins the frame geometry, not the media stack.
// The Player is stubbed: what matters here is that the preview surface adopts
// the SELECTED screen's CSS-pixel resolution as its layout size.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const daylightAPI = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: (...args) => daylightAPI(...args),
  DaylightMediaPath: (p) => p,
}));
vi.mock('../../../lib/logging/Logger.js', () => {
  const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child: () => logger };
  return { default: () => logger };
});
vi.mock('../../Player/Player.jsx', () => ({ default: () => <div data-testid="player-stub" /> }));

import AdminPreviewPlayer from './AdminPreviewPlayer.jsx';

const SCREENS = { screens: [
  { id: 'living-room', name: 'Living Room', resolution: { width: 960, height: 540 } },
  { id: 'portal', name: 'Portal', resolution: { width: 1280, height: 800 } },
] };

const QUEUE_ITEMS = { items: [
  { id: 'singalong:hymn/277', title: 'As I Search the Holy Scriptures' },
  { id: 'singalong:hymn/2', title: 'The Spirit of God' },
] };

function renderPreview() {
  return render(
    <MantineProvider>
      <AdminPreviewPlayer contentId="singalong:hymn/277" action="Play" onClose={vi.fn()} />
    </MantineProvider>
  );
}

function renderQueuePreview() {
  return render(
    <MantineProvider>
      <AdminPreviewPlayer contentId="list:hymns" action="Queue" onClose={vi.fn()} />
    </MantineProvider>
  );
}

describe('AdminPreviewPlayer frame', () => {
  beforeEach(() => {
    daylightAPI.mockReset();
    daylightAPI.mockResolvedValue(SCREENS);
    window.localStorage.clear();
  });

  it('lays the preview out at the first screen resolution, not a hardcoded 1920', async () => {
    const { container } = renderPreview();

    await waitFor(() => {
      const inner = container.querySelector('.admin-preview-player__video-inner');
      expect(inner).toBeTruthy();
    });
    const root = container.querySelector('.admin-preview-player');
    await waitFor(() => {
      expect(root.style.getPropertyValue('--preview-screen-width')).toBe('960px');
    });
    expect(root.style.getPropertyValue('--preview-scale')).toBe('1');
    expect(root.style.getPropertyValue('--preview-box-height')).toBe('540px');
  });

  it('re-scales when a different screen is chosen', async () => {
    const { container } = renderPreview();
    const select = await screen.findByLabelText('Preview at screen');
    // WAIT FOR THE OPTION, not just the select. Before the API answers,
    // `screens` holds only FALLBACK_SCREEN (see the note below on stranding) —
    // the control is on screen with `portal` not yet in it, and changing to a
    // value that does not exist is a no-op the assertions then wait out. The
    // sweep only lost this race when the machine was busy.
    await waitFor(() => expect(
      [...select.options].some((o) => o.value === 'portal'),
    ).toBe(true));

    fireEvent.change(select, { target: { value: 'portal' } });

    await waitFor(() => {
      const root = container.querySelector('.admin-preview-player');
      expect(root.style.getPropertyValue('--preview-screen-width')).toBe('1280px');
      expect(root.style.getPropertyValue('--preview-scale')).toBe('0.75');
      expect(root.style.getPropertyValue('--preview-box-height')).toBe('600px');
    });
  });

  // Renamed after review. This was called "does not strand the selection on the
  // fallback id", but mutation testing showed it catches no stranding case
  // uniquely — a seeded-selection implementation still passes it, because the
  // `|| screens[0]` fallback rescues the dead id anyway. Stranding is only
  // observable when the selection should resolve somewhere OTHER than screens[0],
  // which requires a stored id — that is the persistence test's scenario, and
  // the stranding rationale now lives there. What this test does pin, and pins
  // alone, is the in-flight-fallback → resolved-screen transition.
  it('swaps from the in-flight fallback frame to the resolved screen once the API settles', async () => {
    // Before the API answers, `screens` holds only FALLBACK_SCREEN, whose id
    // ('__fallback') is absent from the real list that replaces it. Selection is
    // DERIVED (find-then-fall-back), never copied into state from `screens[0]`,
    // so it must recover on its own. An implementation that seeds `useState`
    // from `screens[0].id` strands a dead id here.
    let resolve;
    daylightAPI.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { container } = renderPreview();

    await waitFor(() => {
      const root = container.querySelector('.admin-preview-player');
      expect(root.style.getPropertyValue('--preview-screen-width')).toBe('1280px'); // fallback, in flight
    });

    resolve(SCREENS);

    await waitFor(() => {
      const root = container.querySelector('.admin-preview-player');
      expect(root.style.getPropertyValue('--preview-screen-width')).toBe('960px'); // real living-room
    });
  });

  // This is also where stranding is actually observable: the stored id makes the
  // selection resolve somewhere other than screens[0], so an implementation that
  // seeds state from screens[0].id (stranding '__fallback' from the in-flight
  // window) fails here rather than silently passing.
  it('remembers the chosen screen across mounts', async () => {
    const first = renderPreview();
    await waitFor(() => expect(screen.getByLabelText('Preview at screen')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Preview at screen'), { target: { value: 'portal' } });
    await waitFor(() => expect(window.localStorage.getItem('daylight.adminPreview.screenId')).toBe('portal'));
    first.unmount();

    const { container } = renderPreview();

    // Assert on BOX HEIGHT, not width: the in-flight FALLBACK_SCREEN is also
    // 1280 wide, so a width assertion is satisfied by the pre-API render and
    // passes whether or not the stored id is ever read. 600px is portal's
    // alone — fallback and living-room both give 540px.
    await waitFor(() => {
      const root = container.querySelector('.admin-preview-player');
      expect(root.style.getPropertyValue('--preview-box-height')).toBe('600px');
      expect(root.style.getPropertyValue('--preview-screen-width')).toBe('1280px');
    });
    expect(screen.getByLabelText('Preview at screen').value).toBe('portal');
  });

  // Queue is a first-class preview mode with its own render path. Without this,
  // deleting style={frameVars} from the Queue branch alone leaves the whole
  // suite green — and since a wrong-but-plausible frame size is invisible by
  // construction, an untested branch is where a regression goes unnoticed.
  it('applies the frame to the Queue render path too', async () => {
    daylightAPI.mockImplementation((path) => (
      String(path).startsWith('api/v1/queue')
        ? Promise.resolve(QUEUE_ITEMS)
        : Promise.resolve(SCREENS)
    ));

    const { container } = renderQueuePreview();

    await waitFor(() => {
      expect(container.querySelector('.admin-preview-player__video-inner')).toBeTruthy();
    });
    await waitFor(() => {
      const root = container.querySelector('.admin-preview-player');
      expect(root.style.getPropertyValue('--preview-screen-width')).toBe('960px');
      expect(root.style.getPropertyValue('--preview-scale')).toBe('1');
    });
    // Confirm we really are on the queue branch, not silently on Play mode.
    expect(container.querySelector('.admin-preview-player__queue-bar')).toBeTruthy();
  });
});
