import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useContentFilter } from '../../../lib/Player/useContentFilter.js';
import { useFilterData } from '../../../lib/Player/useFilterData.js';
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

  // Optional: load REAL filter data for a title via ?contentId=plex:<ratingKey>.
  // Falls back to the built-in demo EDL when absent.
  const contentId = useMemo(() => new URLSearchParams(window.location.search).get('contentId'), []);
  const realData = useFilterData(contentId, { enabled: !!contentId });
  const edl = contentId ? realData?.edl : EDL;
  const profile = contentId ? realData?.profile : PROFILE;
  const override = contentId ? realData?.override : undefined;

  // Card-demo mode: ?card=<text> renders the art-backed title card full-frame so it
  // can be screenshotted (uses the title's Plex art via the proxy, from contentId).
  const cardDemo = useMemo(() => new URLSearchParams(window.location.search).get('card'), []);
  const art = useMemo(() => {
    if (!contentId) return null;
    const rk = String(contentId).replace(/^plex:/, '');
    const base = `/api/v1/proxy/plex/library/metadata/${rk}`;
    const noLogo = new URLSearchParams(window.location.search).has('nologo'); // demo the poster-left fallback
    return { poster: `${base}/thumb`, background: `${base}/art`, logo: noLogo ? undefined : `${base}/clearLogo` };
  }, [contentId]);

  const getMediaEl = useCallback(() => videoRef.current, []);
  const transport = useMemo(() => ({
    seek: (s) => {
      const el = videoRef.current;
      if (el) { el.currentTime = s; skipsRef.current += 1; }
    },
  }), []);

  const { activeOverlays, activeCard, effectiveCues } = useContentFilter({
    getMediaEl, transport, edl, profile, override, enabled: !!edl,
  });

  const onTimeUpdate = () => {
    const el = videoRef.current;
    if (el) setTick({ t: el.currentTime, muted: el.muted });
  };

  const byEffect = effectiveCues.reduce((a, c) => ((a[c.effect] = (a[c.effect] || 0) + 1), a), {});
  const status = {
    t: Math.round(tick.t * 10) / 10,
    muted: tick.muted,
    overlays: activeOverlays.map((o) => o.effect),
    card: activeCard?.text || null,
    skips: skipsRef.current,
    cues: effectiveCues.length,
    byEffect,
    title: edl?.title || null,
    profileName: profile?.name || null,
  };

  if (cardDemo) {
    return (
      <div data-testid="card-demo" style={{ margin: 0, width: '100vw', height: '100vh', background: '#000', position: 'relative' }}>
        <div className="video-player" style={{ position: 'absolute', inset: 0 }}>
          <FilterOverlay activeCard={{ text: cardDemo }} art={art} theme={profile?.theme || PROFILE.theme} />
        </div>
      </div>
    );
  }

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
        <FilterOverlay activeOverlays={activeOverlays} activeCard={activeCard} theme={profile?.theme || PROFILE.theme} />
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
