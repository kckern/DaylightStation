/**
 * <dash-video> re-key logging — Tier 1.3.
 *
 * The element's React key is a composite of three independent inputs, and a
 * change to any one of them destroys the live element, builds a new one and —
 * for a Plex dash source — opens a new transcode session. None of the three was
 * logged. On 2026-08-16 that path ran roughly three hundred times in four
 * minutes and our own telemetry had nothing to say about it.
 *
 * `changedComponent` is the field these tests exist for: a url change is the
 * recovery path re-minting a stream, a bitrate change is the ABR cap moving,
 * and an elementKey change is a soft re-init. They call for different fixes and
 * a bare key diff cannot tell them apart.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

const sampled = [];

vi.mock('../lib/dashCleanup.js', () => ({ cleanupDashElement: vi.fn() }));

// Defined inside the factory: vi.mock is hoisted above every const in the file.
vi.mock('../../../../../frontend/src/lib/logging/Logger.js', () => {
  const stub = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    log: () => {},
    sampled: (event, data, options) => { sampled.push({ event, data, options }); },
    child: () => stub
  };
  return { __esModule: true, getLogger: () => stub, default: () => stub };
});

// Intro slot wiring: a controllable installed intro and gate stage. Defaults
// (no intro, gate off) leave the re-key cases above untouched.
const introSlot = vi.hoisted(() => ({ intro: null, stage: 'off', gateArgs: null }));
vi.mock('../../presentation.mjs', () => ({
  useVideoPresentation: () => ({ overlay: null, debug: null }),
  useVideoIntro: () => introSlot.intro,
  getLoadingPresentation: () => ({
    subscribeLoadingSuppression: () => () => {}, getLoadingSuppression: () => false,
  }),
}));
vi.mock('../hooks/useIntroGate.js', () => ({
  useIntroGate: (args) => { introSlot.gateArgs = args; return introSlot.stage; },
}));

import { VideoPlayer } from './VideoPlayer.jsx';

const dashProps = (media) => ({
  media: { mediaType: 'dash_video', title: 'Introduction to Singing', ...media },
  advance: vi.fn(),
  clear: vi.fn()
});

const rekeys = () => sampled.filter((s) => s.event === 'playback.dash-element-rekeyed');

beforeEach(() => {
  sampled.length = 0;
  introSlot.intro = null;
  introSlot.stage = 'off';
  introSlot.gateArgs = null;
});

describe('VideoPlayer — dash element re-key logging', () => {
  it('says nothing on the first element: a mount is not a re-key', () => {
    render(<VideoPlayer {...dashProps({ mediaUrl: '/a.mpd' })} />);
    expect(rekeys()).toHaveLength(0);
  });

  it('names the url when a fresh stream replaces the element', () => {
    const { rerender } = render(<VideoPlayer {...dashProps({ mediaUrl: '/a.mpd' })} />);
    rerender(<VideoPlayer {...dashProps({ mediaUrl: '/b.mpd' })} />);

    expect(rekeys()).toHaveLength(1);
    expect(rekeys()[0].data).toMatchObject({
      changedComponent: 'mediaUrl',
      from: '/a.mpd:unlimited:0',
      to: '/b.mpd:unlimited:0'
    });
  });

  it('names the bitrate cap when only the cap moves', () => {
    const { rerender } = render(<VideoPlayer {...dashProps({ mediaUrl: '/a.mpd' })} />);
    rerender(<VideoPlayer {...dashProps({ mediaUrl: '/a.mpd', maxVideoBitrate: 4000 })} />);

    expect(rekeys()).toHaveLength(1);
    expect(rekeys()[0].data.changedComponent).toBe('bitrate');
    // 'unlimited' rather than a blank or a zero: an uncapped stream is a real
    // state, not a missing measurement.
    expect(rekeys()[0].data.from).toBe('/a.mpd:unlimited:0');
    expect(rekeys()[0].data.to).toBe('/a.mpd:4000:0');
  });

  it('names both inputs when both move at once', () => {
    const { rerender } = render(<VideoPlayer {...dashProps({ mediaUrl: '/a.mpd' })} />);
    rerender(<VideoPlayer {...dashProps({ mediaUrl: '/b.mpd', maxVideoBitrate: 4000 })} />);

    expect(rekeys()).toHaveLength(1);
    expect(rekeys()[0].data.changedComponent).toBe('mediaUrl+bitrate');
  });

  it('stays quiet when an equivalent media object re-renders the same element', () => {
    const { rerender } = render(<VideoPlayer {...dashProps({ mediaUrl: '/a.mpd' })} />);
    rerender(<VideoPlayer {...dashProps({ mediaUrl: '/a.mpd' })} />);
    rerender(<VideoPlayer {...dashProps({ mediaUrl: '/a.mpd' })} />);
    expect(rekeys()).toHaveLength(0);
  });

  it('is rate limited, because this is the path that stormed', () => {
    const { rerender } = render(<VideoPlayer {...dashProps({ mediaUrl: '/a.mpd' })} />);
    rerender(<VideoPlayer {...dashProps({ mediaUrl: '/b.mpd' })} />);
    expect(rekeys()[0].options).toMatchObject({ maxPerMinute: 30, aggregate: true });
  });

  it('carries the mount identity, so a re-key can be tied to its recovery budget', () => {
    const { rerender } = render(<VideoPlayer {...dashProps({ mediaUrl: '/a.mpd' })} />);
    rerender(<VideoPlayer {...dashProps({ mediaUrl: '/b.mpd' })} />);
    expect(rekeys()[0].data.mountId).toMatch(/^video-mount-\d+$/);
    expect(rekeys()[0].data.isDash).toBe(true);
  });
});

describe('VideoPlayer — intro slot', () => {
  const scene = () => ({
    status: 'ready', minHoldMs: 0,
    render: (stage) => <div data-testid="intro-scene" data-stage={stage} />,
  });

  it('draws nothing when no intro is installed', () => {
    const { queryByTestId } = render(<VideoPlayer {...dashProps({ mediaUrl: '/a.mpd' })} />);
    expect(queryByTestId('intro-scene')).toBeNull();
  });

  it('draws nothing while the gate is still waiting', () => {
    introSlot.intro = scene();
    introSlot.stage = 'waiting';
    const { queryByTestId } = render(<VideoPlayer {...dashProps({ mediaUrl: '/a.mpd' })} />);
    expect(queryByTestId('intro-scene')).toBeNull();
  });

  it.each(['covering', 'holding', 'playing'])('draws the scene with the %s stage', (stage) => {
    introSlot.intro = scene();
    introSlot.stage = stage;
    const { getByTestId } = render(<VideoPlayer {...dashProps({ mediaUrl: '/a.mpd' })} />);
    expect(getByTestId('intro-scene').dataset.stage).toBe(stage);
  });

  it('hands the gate the requested start and a per-title reset key', () => {
    render(<VideoPlayer {...dashProps({ mediaUrl: '/a.mpd', assetId: 'movie-a', seconds: 42 })} />);
    expect(introSlot.gateArgs).toMatchObject({ startSec: 42, resetKey: 'movie-a' });
  });
});
