/**
 * useProvenanceIntro — the Media app's intro for the shared Player: the
 * streaming-service scene in front of a Plex title. The Player owns the gate
 * (cover, hold the first frame, step aside); this supplies the status, the
 * hold length and the scene drawn for each stage.
 *
 * `?provenance=0` on the page URL turns it off for one page load.
 *
 * Reference: __docs/reference/media/provenance.md
 */
import React, { useCallback, useMemo } from 'react';
import { useProvenance } from './useProvenance.js';
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
  const contentId = isPlex ? (media?.assetId || media?.key || media?.plex || null) : null;
  const eligible = !!contentId && !provenanceOptedOut(search);
  const { data, status } = useProvenance(contentId, { enabled: eligible });
  const minHoldMs = useMemo(() => pickLinkMs(SCENE_TIMING), [contentId]);

  const render = useCallback(
    (stage) => <ProvenanceScene stage={stage} provenance={data} linkMs={minHoldMs} />,
    [data, minHoldMs],
  );
  const introStatus = status === 'ready' && !data ? 'none' : (INTRO_STATUS[status] || 'none');

  return useMemo(
    () => (eligible ? { status: introStatus, minHoldMs, render } : null),
    [eligible, introStatus, minHoldMs, render],
  );
}
