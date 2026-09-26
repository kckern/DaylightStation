import { useState } from 'react';
import { nutritionIconUrl } from './iconUrl.js';
import { reportArtworkFailure } from './artworkLog.js';

// Icons already decoded in this page session. Rows remount on every day
// flip; without this each icon would start over on the placeholder and fade
// in again, which reads as the whole list flickering.
const decodedIcons = new Set();

/** Test seam: forget decoded icons. */
export function resetDecodedIcons() { decodedIcons.clear(); }

/** Fetch and decode an icon ahead of any row that shows it (day prefetch). */
export function preloadFoodIcon(icon) {
  const url = icon && icon !== 'default' ? nutritionIconUrl(icon) : null;
  if (!url || decodedIcons.has(url)) return;
  const img = new Image();
  img.src = url;
  img.decode?.().then(() => decodedIcons.add(url), () => {});
}

/**
 * One honest fallback for unassigned, unsupported, or failed food artwork.
 * `pending`: the artwork queue is still finding this food an icon, so the
 * fallback is shown as work in progress (data-state="pending"), not as final.
 */
export function FoodIcon({ icon, className = 'health-row__icon', alt = '', pending = false }) {
  const [failed, setFailed] = useState(null);
  const [loaded, setLoaded] = useState(null);
  const url = failed === icon || !icon || icon === 'default' ? null : nutritionIconUrl(icon);
  const ready = !!url && (loaded === url || decodedIcons.has(url));
  const state = ready ? 'ready' : failed === icon && icon ? (pending ? 'pending' : 'failed') : url ? 'loading' : pending ? 'pending' : 'missing';
  return <span className={`${className} health-food-art`} data-state={state}
    {...(state === 'pending' ? { role: 'img', 'aria-label': 'Finding an icon', title: 'Finding an icon…' } : {})}>
    {!ready ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 13h16a8 8 0 0 1-16 0ZM7 3v5m5-6v6m5-5v5M9 22h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg> : null}
    {url ? <img key={url} src={url} alt={alt} loading={ready ? 'eager' : 'lazy'} decoding="async"
      style={{ opacity: ready ? 1 : 0 }}
      onLoad={async event => {
        const img = event.currentTarget;
        try { await img.decode?.(); decodedIcons.add(url); setLoaded(url); } catch {
          setFailed(icon); reportArtworkFailure('icon', icon, { url, reason: 'decode' });
        }
      }}
      onError={() => { setFailed(icon); reportArtworkFailure('icon', icon, { url, reason: 'load' }); }} /> : null}
  </span>;
}
