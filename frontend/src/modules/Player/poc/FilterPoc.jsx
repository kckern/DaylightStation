import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useContentFilter } from '../../../lib/Player/useContentFilter.js';
import { FilterOverlay } from '../components/FilterOverlay.jsx';

/**
 * Content-filter POC harness (dev/test only, route: /filter-poc).
 *
 * Mounts the REAL useContentFilter hook + FilterOverlay on a plain <video> with a
 * small bundled test clip and a hand-crafted EDL that exercises every effect kind:
 *   skip (transport) -> title-card (overlay) -> mute (audio) -> censor-bar (overlay).
 * A JSON status node ([data-testid="poc-status"]) lets Playwright assert behavior
 * deterministically without depending on Plex.
 */

// Cues carry explicit effects so the POC is self-contained (no profile lookup needed).
const EDL = {
  contentId: 'poc',
  cues: [
    { id: 'skp', effect: 'skip', category: 'violence/graphic', in: 3, out: 8, label: 'fight' },
    { id: 'card', effect: 'title-card', category: 'meta/explainer', in: 8, out: 11, text: 'Skipped a violent scene (demo).' },
    { id: 'mut', effect: 'mute', category: 'language/profanity', in: 11, out: 14, label: 'profanity' },
    { id: 'cen', effect: 'censor-bar', category: 'nudity', in: 15, out: 19, rect: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 }, label: 'nudity' },
  ],
};
const PROFILE = { categories: {}, theme: { barColor: '#000', font: 'Roboto Condensed' } };

export default function FilterPoc() {
  const videoRef = useRef(null);
  const skipsRef = useRef(0);
  const [tick, setTick] = useState({ t: 0, muted: false });

  const getMediaEl = useCallback(() => videoRef.current, []);
  const transport = useMemo(() => ({
    seek: (s) => {
      const el = videoRef.current;
      if (el) { el.currentTime = s; skipsRef.current += 1; }
    },
  }), []);

  const { activeOverlays, activeCard, effectiveCues } = useContentFilter({
    getMediaEl, transport, edl: EDL, profile: PROFILE, enabled: true,
  });

  const onTimeUpdate = () => {
    const el = videoRef.current;
    if (el) setTick({ t: el.currentTime, muted: el.muted });
  };

  const status = {
    t: Math.round(tick.t * 10) / 10,
    muted: tick.muted,
    overlays: activeOverlays.map((o) => o.effect),
    card: activeCard?.text || null,
    skips: skipsRef.current,
    cues: effectiveCues.length,
  };

  return (
    <div style={{ padding: 16, fontFamily: 'Roboto Condensed, sans-serif', color: '#eee', background: '#111', minHeight: '100vh' }}>
      <h2>Content Filter POC</h2>
      <div style={{ position: 'relative', width: 384, height: 216, background: '#000' }}>
        <video
          ref={videoRef}
          data-testid="poc-video"
          src="/filter-poc/clip.webm"
          width={384}
          height={216}
          playsInline
          onTimeUpdate={onTimeUpdate}
          style={{ width: '100%', height: '100%' }}
        />
        <FilterOverlay activeOverlays={activeOverlays} activeCard={activeCard} theme={PROFILE.theme} />
      </div>
      <div style={{ marginTop: 12 }}>
        <button
          data-testid="poc-play"
          onClick={() => { const el = videoRef.current; if (el) { el.playbackRate = 2; el.muted = false; el.play?.(); } }}
        >
          Play
        </button>
      </div>
      <pre data-testid="poc-status" style={{ marginTop: 12, background: '#000', padding: 8 }}>
        {JSON.stringify(status)}
      </pre>
    </div>
  );
}
