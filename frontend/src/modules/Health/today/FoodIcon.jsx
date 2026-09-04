import { useState } from 'react';
import { nutritionIconUrl } from './iconUrl.js';

/** One honest fallback for unassigned, unsupported, or failed food artwork. */
export function FoodIcon({ icon, className = 'health-row__icon', alt = '' }) {
  const [failed, setFailed] = useState(null);
  const url = failed === icon ? null : nutritionIconUrl(icon);
  return url ? <img className={className} src={url} alt={alt} loading="lazy" onError={() => setFailed(icon)} />
    : <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 3v6m-2-6v4a2 2 0 004 0V3M3 9v12M21 3v18m0-18c-3 3-3 8 0 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>;
}
