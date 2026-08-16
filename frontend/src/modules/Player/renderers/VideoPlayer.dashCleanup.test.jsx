// Regression coverage for the 2026-08-16 "echo" on the piano kiosk.
//
// The <dash-video> element's React key is a composite of mediaUrl, the bitrate
// cap and elementKey, so a change to any of those destroys the element and
// builds a new one WITHOUT unmounting VideoPlayer. The cleanup effect had `[]`
// deps, so it captured the FIRST element and never ran again: every later
// dash.js MediaPlayer leaked, still fetching segments. Plex logged two
// transcode sessions delivering the same audio segment 86 ms apart, which the
// family heard as doubled audio. dash-video-element has no disconnectedCallback,
// so this effect is the only teardown there is.
//
// These tests drive the real VideoPlayer rather than a stand-in harness, so
// they fail if the effect's deps and the element's key ever drift apart again.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { cleanupDashElement } from '../lib/dashCleanup.js';
import { VideoPlayer } from './VideoPlayer.jsx';

vi.mock('../lib/dashCleanup.js', () => ({ cleanupDashElement: vi.fn() }));

beforeEach(() => { cleanupDashElement.mockClear(); });

// A dash source, which is what the piano lecture player renders.
const dashProps = (media) => ({
  media: { mediaType: 'dash_video', title: 'Introduction to Singing', ...media },
  advance: vi.fn(),
  clear: vi.fn(),
});

const cleanedElements = () => cleanupDashElement.mock.calls.map((call) => call[0]);
const lastCleaned = () => cleanedElements().at(-1);

describe('VideoPlayer — dash element teardown', () => {
  it('tears down each <dash-video> generation as it is replaced', () => {
    const { container, rerender, unmount } = render(
      <VideoPlayer {...dashProps({ mediaUrl: '/a.mpd' })} />
    );
    const gen1 = container.querySelector('dash-video');
    expect(gen1).toBeTruthy();
    expect(cleanupDashElement).toHaveBeenCalledTimes(0);

    // A new mediaUrl (what a remount or a hard reset produces) swaps the element.
    rerender(<VideoPlayer {...dashProps({ mediaUrl: '/b.mpd' })} />);
    const gen2 = container.querySelector('dash-video');
    expect(gen2).not.toBe(gen1);
    expect(cleanupDashElement).toHaveBeenCalledTimes(1);
    expect(lastCleaned()).toBe(gen1);

    // So does a change to the bitrate cap, the key's other media-derived input.
    rerender(<VideoPlayer {...dashProps({ mediaUrl: '/b.mpd', maxVideoBitrate: 4000 })} />);
    const gen3 = container.querySelector('dash-video');
    expect(gen3).not.toBe(gen2);
    expect(cleanupDashElement).toHaveBeenCalledTimes(2);
    expect(lastCleaned()).toBe(gen2);

    unmount();
    expect(cleanupDashElement).toHaveBeenCalledTimes(3);
    expect(lastCleaned()).toBe(gen3);
  });

  it('tears down a DIFFERENT element each time, never the same one twice', () => {
    const { container, rerender, unmount } = render(
      <VideoPlayer {...dashProps({ mediaUrl: '/a.mpd' })} />
    );
    rerender(<VideoPlayer {...dashProps({ mediaUrl: '/b.mpd' })} />);
    rerender(<VideoPlayer {...dashProps({ mediaUrl: '/c.mpd' })} />);
    const live = container.querySelector('dash-video');
    unmount();

    const cleaned = cleanedElements();
    expect(cleaned).toHaveLength(3);
    expect(new Set(cleaned).size).toBe(3);
    expect(cleaned.every((el) => el && el.tagName === 'DASH-VIDEO')).toBe(true);
    // The last generation is the one that was on screen; it must be torn down too.
    expect(cleaned.at(-1)).toBe(live);
  });

  it('leaves the on-screen element alone while it is still the current generation', () => {
    const { container, rerender } = render(
      <VideoPlayer {...dashProps({ mediaUrl: '/a.mpd' })} />
    );
    const gen1 = container.querySelector('dash-video');

    // An equivalent media object: same url, same cap, so the key is unchanged and
    // React keeps the element. Tearing it down here would kill live playback.
    rerender(<VideoPlayer {...dashProps({ mediaUrl: '/a.mpd' })} />);
    expect(container.querySelector('dash-video')).toBe(gen1);
    expect(cleanupDashElement).toHaveBeenCalledTimes(0);

    rerender(<VideoPlayer {...dashProps({ mediaUrl: '/b.mpd' })} />);
    const gen2 = container.querySelector('dash-video');
    expect(cleanedElements()).not.toContain(gen2);
  });
});
