/**
 * The piano watch-log must be able to report a lecture shorter than 10s.
 *
 * This hook is the ONLY path that carries `userId` + `engaged` to
 * `/play/log`, so it is what earns a child course credit. It skipped every
 * post until `currentTime >= 10`, mirroring the backend's browsing filter —
 * which means a lecture whose entire duration is under ten seconds was
 * unreportable, and the lesson could never be marked done.
 *
 * See play.shortMedia.test.mjs for the incident this came from.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import usePianoWatchLog from './usePianoWatchLog.js';
import { DaylightAPI } from '../../../../../lib/api.mjs';

vi.mock('../../../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => Promise.resolve({})),
}));

function Harness({ mediaEl, contentId, title }) {
  usePianoWatchLog({
    mediaEl,
    contentId,
    title,
    resumeSeconds: 0,
    userId: 'learner-1',
    engagedRef: { current: true },
  });
  return null;
}

/** A child who watched but never touched a key — engagement unproven. */
function HarnessUnengaged({ mediaEl, contentId, title }) {
  usePianoWatchLog({
    mediaEl,
    contentId,
    title,
    resumeSeconds: 0,
    userId: 'learner-1',
    engagedRef: { current: false },
  });
  return null;
}

const fakeEl = ({ currentTime, duration }) => ({
  currentTime,
  duration,
  paused: false,
  readyState: 4,
  addEventListener: () => {},
  removeEventListener: () => {},
});

const logCalls = () => DaylightAPI.mock.calls.filter(([path]) => path === 'api/v1/play/log');

beforeEach(() => { DaylightAPI.mockClear(); });

describe('usePianoWatchLog — lecture shorter than the browsing floor', () => {
  it('posts progress for a 9.45s lecture watched to the end', () => {
    const el = fakeEl({ currentTime: 9.45, duration: 9.451 });
    const view = render(<Harness mediaEl={el} contentId="plex:694748" title="Coming Soon!" />);

    view.unmount(); // cleanup posts the final 'close' report

    expect(logCalls()).toHaveLength(1);
    expect(logCalls()[0][1]).toMatchObject({
      assetId: 'plex:694748',
      percent: 100,
      userId: 'learner-1',
      engaged: true,
    });
  });

  it('does not post a few seconds of scrubbing through a long lecture', () => {
    const el = fakeEl({ currentTime: 3, duration: 523 });
    const view = render(<Harness mediaEl={el} contentId="plex:694742" title="Singing Harmony" />);

    view.unmount();

    expect(logCalls()).toHaveLength(0);
  });

  /**
   * Completion needs `percent >= threshold` AND `engaged`. Engagement is proven
   * by playing along, and the anti-AFK gate that DEMANDS it only opens after 90
   * seconds idle — so on a lecture shorter than that floor the child is never
   * asked, and `engaged:false` is the absence of a question, not a refusal.
   * Reporting it as unengaged makes such a lecture permanently uncompletable.
   */
  it('counts a lecture too short to play along with as engaged', () => {
    const el = fakeEl({ currentTime: 9.45, duration: 9.451 });
    const view = render(
      <HarnessUnengaged mediaEl={el} contentId="plex:694748" title="Coming Soon!" />,
    );

    view.unmount();

    expect(logCalls()[0][1]).toMatchObject({ engaged: true });
  });

  it('still reports a long lecture watched without playing along as unengaged', () => {
    const el = fakeEl({ currentTime: 500, duration: 523 });
    const view = render(
      <HarnessUnengaged mediaEl={el} contentId="plex:694742" title="Singing Harmony" />,
    );

    view.unmount();

    expect(logCalls()[0][1]).toMatchObject({ engaged: false });
  });
});
