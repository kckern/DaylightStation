import { useState } from 'react';
import { nutritionIconUrl } from './iconUrl.js';

/** One honest fallback for unassigned, unsupported, or failed food artwork. */
export function FoodIcon({ icon, className = 'health-row__icon', alt = '' }) {
  const [failed, setFailed] = useState(null);
  const [loaded, setLoaded] = useState(null);
  const url = failed === icon || !icon || icon === 'default' ? null : nutritionIconUrl(icon);
  const ready = !!url && loaded === url;
  return <span className={`${className} health-food-art`} data-state={ready ? 'ready' : url ? 'loading' : 'missing'}>
    {!ready ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.5" />
    </svg> : null}
    {url ? <img key={url} src={url} alt={alt} loading="lazy" decoding="async"
      style={{ opacity: ready ? 1 : 0 }}
      onLoad={async event => {
        const img = event.currentTarget;
        try { await img.decode?.(); setLoaded(url); } catch { setFailed(icon); }
      }}
      onError={() => setFailed(icon)} /> : null}
  </span>;
}
