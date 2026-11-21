/**
 * useProvenance — the streaming service a Plex title is shown as coming from,
 * from GET /api/v1/provenance/:ratingKey. Also preloads the logo, so the
 * handoff only starts once there is something to draw.
 *
 * status: idle | loading | ready | none | failed
 *   ready -> { provider, name, tier, logo, logoUrl, plate } with the logo loaded;
 *            plate = the logo is too dark for the field and gets a light plate
 *   none  -> nothing confirmed (or the logo would not load): no handoff
 *
 * Reference: __docs/reference/media/provenance.md
 */
import { useEffect, useState } from 'react';
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

export function useProvenance(contentId, { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, status: 'idle' });

  useEffect(() => {
    const rk = String(contentId ?? '').replace(/^plex:/, '');
    if (!enabled || !/^\d+$/.test(rk)) { setState({ data: null, status: 'idle' }); return undefined; }
    let cancelled = false;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const startedAt = Date.now();
    setState({ data: null, status: 'loading' });
    fetch(`/api/v1/provenance/${rk}`, { signal: ctrl?.signal })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(async (body) => {
        const p = body?.provenance;
        if (!p?.provider) {
          if (!cancelled) setState({ data: null, status: 'none' });
          logger().debug('provenance.none', { ratingKey: rk, elapsedMs: Date.now() - startedAt });
          return;
        }
        const logoUrl = logoUrlFor(p);
        let img = null;
        try {
          img = await preload(logoUrl);
        } catch (error) {
          logger().warn('provenance.logo.failed', { ratingKey: rk, provider: p.provider });
          if (!cancelled) setState({ data: null, status: 'none' });
          return;
        }
        if (cancelled) return;
        // A logo too dark for the field (Disney+ navy) is drawn on a light plate.
        const plate = img ? imageNeedsPlate(img) : false;
        setState({ data: { ...p, logoUrl, plate }, status: 'ready' });
        logger().info('provenance.ready', { ratingKey: rk, provider: p.provider, tier: p.tier, plate, elapsedMs: Date.now() - startedAt });
      })
      .catch((error) => {
        if (cancelled || error?.name === 'AbortError') return;
        setState({ data: null, status: 'failed' });
        logger().warn('provenance.fetch.failed', { ratingKey: rk, error: error?.message });
      });
    return () => { cancelled = true; ctrl?.abort(); };
  }, [contentId, enabled]);

  return state;
}
