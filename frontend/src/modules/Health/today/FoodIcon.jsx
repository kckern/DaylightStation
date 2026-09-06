import { useState } from 'react';
import { nutritionIconUrl } from './iconUrl.js';

/** One honest fallback for unassigned, unsupported, or failed food artwork. */
export function FoodIcon({ icon, className = 'health-row__icon', alt = '' }) {
  const [failed, setFailed] = useState(null);
  const [loaded, setLoaded] = useState(null);
  const url = failed === icon || !icon || icon === 'default' ? null : nutritionIconUrl(icon);
  const ready = !!url && loaded === url;
  return <span className={`${className} health-food-art`} data-state={ready ? 'ready' : failed === icon && icon ? 'failed' : url ? 'loading' : 'missing'}>
    {!ready ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 13h16a8 8 0 0 1-16 0ZM7 3v5m5-6v6m5-5v5M9 22h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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
