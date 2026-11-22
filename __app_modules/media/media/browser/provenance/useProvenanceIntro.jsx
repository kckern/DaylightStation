/**
 * useProvenanceIntro — the Media app's intro for the shared Player: the
 * streaming-service scene in front of a Plex title. The Player owns the gate
 * (cover, hold the first frame, step aside); this supplies the status, the
 * hold length, where a play would start (`startSec`, for the early cover) and
 * the scene drawn for each stage.
 *
 * `?provenance=0` on the page URL turns it off for one page load.
 *
 * Reference: __docs/reference/media/provenance.md
 */
import React, { useCallback, useMemo } from 'react';
import { useProvenance, provenanceLookupKey } from './useProvenance.js';
import { ProvenanceHandoff } from './ProvenanceHandoff.jsx';
import { useSceneTimeline, pickLinkMs, SCENE_TIMING } from './useSceneTimeline.js';

export function provenanceOptedOut(search) {
  return /[?&]provenance=0(?:&|$)/.test(String(search || ''));
}

const INTRO_STATUS = Object.freeze({ ready: 'ready', loading: 'pending', idle: 'pending', none: 'none', failed: 'none' });

/** The scene for one Player stage. */
export function ProvenanceScene({ stage, provenance, linkMs }) {
  const phase = useSceneTimeline(stage);
  if (!phase || phase === 'done' || !provenance) return null;
  return <ProvenanceHandoff phase={phase} provenance={provenance} linkMs={linkMs} />;
}

export function useProvenanceIntro({ media, isPlex }) {
  const search = typeof window !== 'undefined' ? window.location.search : '';
  // A live channel (item metadata `live: true`, e.g. plex-live:nfl-channel)
  // opens with its service's scene too; the server answers from its `live` policy.
  const live = media?.metadata?.live === true;
  const contentId = isPlex
    ? (media?.assetId || media?.key || media?.plex || null)
    : (live ? (media?.assetId || media?.contentId || null) : null);
  // Only a numeric Plex rating key or a live channel id can be looked up;
  // anything else would sit `pending` forever (the lookup never starts), so it
  // gets no intro at all.
  const eligible = !!provenanceLookupKey(contentId, { live }) && !provenanceOptedOut(search);
  const { data, status } = useProvenance(contentId, { enabled: eligible, live });
  const minHoldMs = useMemo(() => pickLinkMs(SCENE_TIMING), [contentId]);

  const render = useCallback(
    (stage) => <ProvenanceScene stage={stage} provenance={data} linkMs={minHoldMs} />,
    [data, minHoldMs],
  );
  const introStatus = status === 'ready' && !data ? 'none' : (INTRO_STATUS[status] || 'none');

  // startSec lets the Player start the scene before play info arrives
  // (useIntroHost), only when the title is known to start from the top.
  const startSec = data?.startSec ?? null;
  // A resume after a long absence (server: scene.resume_after_hours) still opens with the scene.
  const resumeOk = data?.resumeShowsScene === true;
  return useMemo(
    () => (eligible ? { status: introStatus, minHoldMs, render, startSec, resumeOk } : null),
    [eligible, introStatus, minHoldMs, render, startSec, resumeOk],
  );
}
