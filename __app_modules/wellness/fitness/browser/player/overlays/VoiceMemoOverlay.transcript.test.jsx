// Review mode shows the whole transcript: a long memo gets the left-aligned,
// top-anchored scrolling layout (--long) in a wider review panel; a short memo
// keeps the centred layout. Layout itself is checked by the overlay harness
// (tests/_scratch/shoot-fitness-overlays.mjs); this pins the class contract.
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const noop = () => {};

vi.mock('@/lib/logging/singleton.js', () => {
  const make = () => ({ log: noop, debug: noop, info: noop, warn: noop, error: noop, sampled: noop, child: () => make() });
  return { getDaylightLogger: () => make() };
});
vi.mock('../../context/FitnessContext.jsx', () => ({
  __esModule: true,
  useFitnessContext: () => ({ pauseMusicPlayer: noop, resumeMusicPlayer: noop }),
  useFitness: () => ({ pauseMusicPlayer: noop, resumeMusicPlayer: noop }),
}));
vi.mock('../panels/hooks/useVoiceMemoRecorder.js', () => ({
  __esModule: true,
  default: () => ({
    isRecording: false, recordingDuration: 0, uploading: false, error: null, setError: noop,
    startRecording: noop, stopRecording: noop, cancelUpload: noop, retryTranscription: noop,
    hasAudioBlob: false, savedArtifact: null,
  }),
}));
vi.mock('../../shared/index.js', () => ({ MicLevelIndicator: () => null }));

import VoiceMemoOverlay from './VoiceMemoOverlay.jsx';

const FIRST = 'This was another workout from the INSANITY franchise.';
const LAST = 'Overall a solid session, and I would do this one again next week.';
const LONG = `${FIRST} This one was less about running around and brought in more dumbbell work. `
  + 'The heart rate was not as high as these workouts typically are, but this one had a muscle '
  + 'endurance component. I started with 20-pound dumbbells and dropped to 15s at the second set. '
  + `The shoulder presses were the hardest part. ${LAST}`;
const SHORT = 'Good workout today, legs felt strong and the intervals went well.';

function renderReview(transcript) {
  const memo = { memoId: 'memo-1', transcriptClean: transcript, transcriptRaw: transcript,
    createdAt: Date.now() - 5000, sessionElapsedSeconds: 1845, videoTimeSeconds: 1610 };
  render(
    <VoiceMemoOverlay
      overlayState={{ open: true, mode: 'review', memoId: 'memo-1', autoAccept: false, startedAt: Date.now() }}
      voiceMemos={[memo]}
      onClose={noop} onOpenReview={noop} onOpenList={noop} onOpenRedo={noop}
      onRemoveMemo={noop} onAddMemo={noop} onReplaceMemo={noop}
      sessionId="session-fixture"
      playerRef={{ current: null }}
    />
  );
  // The overlay portals to document.body.
  return {
    panel: document.body.querySelector('.voice-memo-overlay__panel'),
    transcript: document.body.querySelector('.voice-memo-overlay__transcript--large'),
  };
}

describe('VoiceMemoOverlay review transcript', () => {
  afterEach(() => cleanup());

  it('gives a long transcript the scrolling --long layout and keeps all of its text', () => {
    expect(LONG.length).toBeGreaterThan(200);
    const { panel, transcript } = renderReview(LONG);
    expect(transcript).not.toBeNull();
    expect(transcript.classList.contains('voice-memo-overlay__transcript--long')).toBe(true);
    expect(transcript.hasAttribute('data-harness-scroll')).toBe(true);
    expect(transcript.textContent).toContain(FIRST);
    expect(transcript.textContent).toContain(LAST);
    expect(panel.classList.contains('voice-memo-overlay__panel--review')).toBe(true);
  });

  it('keeps a short transcript on the centred layout', () => {
    const { panel, transcript } = renderReview(SHORT);
    expect(transcript.classList.contains('voice-memo-overlay__transcript--long')).toBe(false);
    expect(transcript.textContent).toBe(SHORT);
    expect(panel.classList.contains('voice-memo-overlay__panel--review')).toBe(true);
  });
});
