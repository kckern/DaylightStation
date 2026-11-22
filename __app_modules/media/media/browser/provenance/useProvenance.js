/**
 * useProvenance — the streaming service a Plex title is shown as coming from,
 * from GET /api/v1/provenance/:ratingKey. Also preloads the logo, so the
 * handoff only starts once there is something to draw. A live channel
 * (`{ live: true }`) is looked up by its whole `<source>:<channel>` id.
 *
 * status: idle | loading | ready | none | failed
 *   idle  -> disabled, or not a numeric Plex rating key (never fetched)
 *   failed -> the request failed or did not answer in PROVENANCE_FETCH_TIMEOUT_MS
 *   ready -> { provider, name, tier, logo, logoUrl, plate, startSec, secondaryUrls } with the logo loaded;
 *            secondaryUrls = smaller logos for under the service's (config
 *            `secondary_logos`), in order; any that would not load are left out;
 *            plate = the logo is too dark for the field and gets a light plate;
 *            startSec = where a play would start (0 = the top), null if unknown
 *   none  -> nothing confirmed (or the logo would not load): no handoff
 *
 * Reference: __docs/reference/media/provenance.md
 */
import { useEffect, useState } from 'react';
import { daylightApiResponse } from '../../../../../frontend/src/lib/api.mjs';
import { getChildLogger } from '../../../../../frontend/src/lib/logging/singleton.js';
import { imageNeedsPlate } from './logoContrast.js';

let _logger;
const logger = () => (_logger ||= getChildLogger({ component: 'provenance' }));

/** Logo URL for the dark scene: the white variant when the provider has one (the server falls back). */
export const logoUrlFor = (data) => (data?.logo ? `${data.logo}?variant=white` : null);

function preload(src) {
  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined') { resolve(null); return; }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('logo failed to load'));
    img.src = src;
  });
}

/** A lookup (fetch + logo) that has not answered in this long is given up as `failed`. */
export const PROVENANCE_FETCH_TIMEOUT_MS = 8000;

/** The numeric Plex rating key the lookup needs, or null when it can never ask. */
export function provenanceRatingKey(contentId) {
  const rk = String(contentId ?? '').replace(/^plex:/, '');
  return /^\d+$/.test(rk) ? rk : null;
}

/**
 * The key the lookup asks with: a Plex title's numeric rating key, or a live
 * channel's whole `<source>:<channel>` id. null when it can never ask.
 */
export function provenanceLookupKey(contentId, { live = false } = {}) {
  const rk = provenanceRatingKey(contentId);
  if (rk) return rk;
  const id = String(contentId ?? '');
  return live && /^[a-z0-9-]+:[a-z0-9-]+$/.test(id) ? id : null;
}

const IDLE = Object.freeze({ data: null, status: 'idle' });
const LOADING = Object.freeze({ data: null, status: 'loading' });

export function useProvenance(contentId, { enabled = true, live = false } = {}) {
  const rk = enabled ? provenanceLookupKey(contentId, { live }) : null;
  // State is keyed by rating key: a new title never sees the last one's answer,
  // not even on the first render before the effect runs.
  const [state, setState] = useState({ key: null, data: null, status: 'idle' });

  useEffect(() => {
    if (!rk) return undefined;
    let done = false; // cancelled, timed out, or answered
    const settle = (next) => { if (done) return false; done = true; setState({ key: rk, ...next }); return true; };
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const startedAt = Date.now();
    setState({ key: rk, ...LOADING });
    const timer = setTimeout(() => {
      if (settle({ data: null, status: 'failed' })) {
        ctrl?.abort();
        logger().warn('provenance.fetch.failed', { ratingKey: rk, error: 'timeout', timeoutMs: PROVENANCE_FETCH_TIMEOUT_MS });
      }
    }, PROVENANCE_FETCH_TIMEOUT_MS);
    daylightApiResponse(`/api/v1/provenance/${rk}`, { signal: ctrl?.signal })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(async (body) => {
        const p = body?.provenance;
        if (!p?.provider) {
          if (settle({ data: null, status: 'none' })) {
            logger().debug('provenance.none', { ratingKey: rk, elapsedMs: Date.now() - startedAt });
          }
          return;
        }
        const logoUrl = logoUrlFor(p);
        let img = null;
        try {
          img = await preload(logoUrl);
        } catch (error) {
          if (settle({ data: null, status: 'none' })) {
            logger().warn('provenance.logo.failed', { ratingKey: rk, provider: p.provider });
          }
          return;
        }
        // A logo too dark for the field (Disney+ navy) is drawn on a light plate.
        const plate = img ? imageNeedsPlate(img) : false;
        // Secondary logos are extra: one that will not load is left out, the scene still plays.
        const wanted = (Array.isArray(p.secondary) ? p.secondary : []).filter((s) => s?.logo);
        const loaded = await Promise.all(wanted.map(async (s) => {
          const url = logoUrlFor(s);
          try { await preload(url); return url; } catch {
            logger().warn('provenance.secondary-logo.failed', { ratingKey: rk, logo: s.logo });
            return null;
          }
        }));
        const secondaryUrls = loaded.filter(Boolean);
        // Where a play of the title would start (0 = the top), or null when unknown.
        const startSec = Number.isFinite(body?.startSec) ? body.startSec : null;
        // A resume after a long absence still opens with the scene.
        const resumeShowsScene = body?.resumeShowsScene === true;
        if (settle({ data: { ...p, logoUrl, plate, startSec, resumeShowsScene, secondaryUrls }, status: 'ready' })) {
          logger().info('provenance.ready', {
            ratingKey: rk, provider: p.provider, tier: p.tier, plate, startSec,
            secondary: secondaryUrls.length, elapsedMs: Date.now() - startedAt,
          });
        }
      })
      .catch((error) => {
        if (done || error?.name === 'AbortError') return;
        settle({ data: null, status: 'failed' });
        logger().warn('provenance.fetch.failed', { ratingKey: rk, error: error?.message });
      })
      .finally(() => clearTimeout(timer));
    return () => { done = true; clearTimeout(timer); ctrl?.abort(); };
  }, [rk]);

  if (!rk) return IDLE;
  if (state.key !== rk) return LOADING;
  return { data: state.data, status: state.status };
}
