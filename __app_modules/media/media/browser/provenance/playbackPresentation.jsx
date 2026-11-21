/**
 * The Media app's video presentation: the provenance handoff in front of the
 * film, then the content filter's chrome. The filter's opening bumper waits
 * until the handoff has docked (or was skipped), so the two never cover each
 * other. `?provenance=0` turns the handoff off for one page load.
 *
 * Reference: __docs/reference/media/provenance.md
 */
import React from 'react';
import { useMediaVideoPresentation } from '../content-filter/videoPresentation.jsx';
import { subscribeSkipCard, isSkipCardPaused } from '../content-filter/skipCardState.js';
import { useProvenance } from './useProvenance.js';
import { useProvenanceHandoff, SCENE_PHASES } from './useProvenanceHandoff.js';
import { ProvenanceHandoff } from './ProvenanceHandoff.jsx';
import { subscribeProvenanceHold, isProvenanceHolding } from './provenanceHold.js';

export function provenanceOptedOut(search) {
  return /[?&]provenance=0(?:&|$)/.test(String(search || ''));
}

export function useMediaPlaybackPresentation({ media, isPlex, getMediaEl }) {
  const search = typeof window !== 'undefined' ? window.location.search : '';
  const contentId = isPlex ? (media?.assetId || media?.key || media?.plex || null) : null;
  const eligible = !!contentId && !provenanceOptedOut(search);
  const { data, status } = useProvenance(contentId, { enabled: eligible });
  const { phase, afterHandoff, linkMs } = useProvenanceHandoff({ getMediaEl, contentId, eligible, status, provenance: data });
  const filter = useMediaVideoPresentation({ media, isPlex, getMediaEl, bumperHeld: !afterHandoff });

  const scene = data && SCENE_PHASES.includes(phase)
    ? <ProvenanceHandoff phase={phase} provenance={data} linkMs={linkMs} />
    : null;
  if (!scene) return filter;
  return { ...filter, overlay: <>{filter.overlay || null}{scene}</> };
}

/** Loading overlay stays quiet during either deliberate pause: a skip card, or the handoff hold. */
export function subscribeMediaLoadingSuppression(cb) {
  const a = subscribeSkipCard(cb);
  const b = subscribeProvenanceHold(cb);
  return () => { a(); b(); };
}

export function getMediaLoadingSuppression() {
  return isSkipCardPaused() || isProvenanceHolding();
}
