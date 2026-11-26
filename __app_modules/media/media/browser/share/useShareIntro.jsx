/**
 * useShareIntro — the Media app's intro for a video shared from the phone
 * (`share:<jobId>`): the provider's provenance scene, following the real
 * fetch. The provider (and so the logo) comes from the server; nothing here
 * knows which service a share is from.
 *
 * While the job is downloading the intro HOLDS the play request
 * (`holdRequest`): the Player fetches no play info, and the scene covers from
 * the request with the lines reaching in as the bytes arrive (and stalling
 * when they stall). When the job is ready the hold lifts, the Player fetches
 * the `share:` item and the lines meet as the video starts. A failed job
 * shows the failed scene until the backend stops the screen.
 *
 * Reference: __docs/reference/core/share.md
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { daylightApiResponse } from '../../../../../frontend/src/lib/api.mjs';
import { getChildLogger } from '../../../../../frontend/src/lib/logging/singleton.js';
import { logoUrlFor } from '../provenance/useProvenance.js';
import { imageNeedsPlate } from '../provenance/logoContrast.js';
import { ProvenanceHandoff } from '../provenance/ProvenanceHandoff.jsx';
import { useSceneTimeline } from '../provenance/useSceneTimeline.js';

let _logger;
const logger = () => (_logger ||= getChildLogger({ component: 'share-intro' }));

const SHARE_ID = /^share:(s[0-9a-f]{12})$/;
/** How often the job is asked while it is fetching: the lines move with each answer. */
export const SHARE_POLL_MS = 700;
/** After the hold lifts, the scene holds the first frame this long before the lines meet. */
export const SHARE_MIN_HOLD_MS = 900;
/** A job the server no longer knows (it restarted) lets go after this long. */
const GONE_RELEASE_MS = 6000;

export function shareJobIdOf(contentId) {
  const m = SHARE_ID.exec(String(contentId ?? ''));
  return m ? m[1] : null;
}

function preload(src) {
  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined') { resolve(null); return; }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('logo failed to load'));
    img.src = src;
  });
}

/** The job as the server reports it, polled until it is ready, failed or gone. */
export function useShareJob(jobId, { pollMs = SHARE_POLL_MS } = {}) {
  const [state, setState] = useState({ key: null, job: null, logo: null, gone: false });
  useEffect(() => {
    if (!jobId) return undefined;
    let cancelled = false;
    let timer = null;
    let logoFor = null;
    let goneSince = null;
    setState({ key: jobId, job: null, logo: null, gone: false });
    logger().info('share-intro.start', { jobId });
    const tick = async () => {
      let job = null;
      try {
        const r = await daylightApiResponse(`/api/v1/share/jobs/${jobId}`);
        if (r.status === 404) {
          goneSince ??= Date.now();
          if (Date.now() - goneSince >= GONE_RELEASE_MS) {
            if (!cancelled) setState((s) => ({ ...s, key: jobId, gone: true }));
            logger().warn('share-intro.gone', { jobId });
            return;
          }
        } else if (r.ok) {
          job = await r.json();
          goneSince = null;
        }
      } catch (error) {
        logger().sampled('share-intro.poll-failed', { jobId, error: error?.message }, { maxPerMinute: 6 });
      }
      if (cancelled) return;
      if (job) {
        const p = job.provenance;
        if (p?.logo && logoFor !== p.logo) {
          logoFor = p.logo;
          const url = logoUrlFor(p);
          preload(url).then((img) => {
            if (!cancelled) setState((s) => ({ ...s, logo: { ...p, logoUrl: url, plate: img ? imageNeedsPlate(img) : false } }));
          }).catch(() => logger().warn('share-intro.logo-failed', { jobId, provider: p.provider }));
        }
        setState((s) => ({ ...s, key: jobId, job }));
        if (job.state === 'ready' || job.state === 'failed') {
          logger().info(`share-intro.${job.state}`, { jobId, provider: p?.provider ?? null });
          return;
        }
      }
      timer = setTimeout(tick, pollMs);
    };
    tick();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [jobId, pollMs]);
  return state.key === jobId ? state : { key: jobId, job: null, logo: null, gone: false };
}

/** The scene for one Player stage, with the real progress while it links. */
export function ShareScene({ stage, provenance, progress, failed }) {
  const phase = useSceneTimeline(stage);
  if (!phase || phase === 'done' || !provenance) return null;
  return <ProvenanceHandoff phase={phase} provenance={provenance} progress={progress} failed={failed} />;
}

export function useShareIntro({ media }) {
  const jobId = shareJobIdOf(media?.assetId);
  const { job, logo, gone } = useShareJob(jobId);
  const failed = job?.state === 'failed';
  const progress = job ? Math.max(0, Math.min(1, Number(job.progress) || 0)) : 0;
  // Held until the file is in. A failed job stays held (the backend stops the
  // screen); a job the server lost lets go so the Player can say so itself.
  const holdRequest = !!jobId && !gone && job?.state !== 'ready';

  const render = useCallback(
    (stage) => <ShareScene stage={stage} provenance={logo} progress={progress} failed={failed} />,
    [logo, progress, failed],
  );
  return useMemo(() => (jobId
    ? { status: gone ? 'none' : (logo ? 'ready' : 'pending'), minHoldMs: SHARE_MIN_HOLD_MS, render, startSec: 0, resumeOk: false, holdRequest }
    : null), [jobId, gone, logo, render, holdRequest]);
}
