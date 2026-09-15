/**
 * CoinIcon — a coin: rim, inner ring, face and a struck symbol.
 *
 * Ported from an SVG Repo gold coin (512 viewBox). The source's four fixed
 * yellows become a tint ladder around one `color`, so silver and gold (the
 * two household currencies) are `color="#c0c0c0"` and the default. The struck
 * symbol is the source's own dollar-sign path; pass `symbol={false}` for a
 * plain disc.
 *
 * No document-level ids, no gradients, so instances can repeat freely.
 */
import { useId } from 'react';
import { relight } from './iconColor.js';

const SYMBOL_PATH = 'M291.31,253.95v-93.357c18.276,6.737,30.897,18.294,30.897,30.856c0,7.31,5.931,13.241,13.241,13.241s13.241-5.931,13.241-13.241c0-26.968-23.418-49.479-57.379-58.808v-9.054c0-7.31-5.931-13.241-13.241-13.241c-7.31,0-13.241,5.931-13.241,13.241v4.71c-2.905-0.18-5.843-0.296-8.828-0.296s-5.922,0.116-8.828,0.296v-4.71c0-7.31-5.931-13.241-13.241-13.241s-13.241,5.931-13.241,13.241v9.054c-33.961,9.33-57.379,31.839-57.379,58.808c0,35.75,24.744,53.774,57.379,66.601v93.357c-18.276-6.737-30.897-18.294-30.897-30.856c0-7.31-5.931-13.241-13.241-13.241s-13.241,5.931-13.241,13.241c0,26.968,23.418,49.479,57.379,58.808v9.055c0,7.31,5.931,13.241,13.241,13.241s13.241-5.931,13.241-13.241v-4.71c2.905,0.18,5.843,0.296,8.828,0.296s5.922-0.116,8.828-0.296v4.71c0,7.31,5.931,13.241,13.241,13.241c7.31,0,13.241-5.931,13.241-13.241v-9.054c33.961-9.33,57.379-31.839,57.379-58.808C348.69,284.801,323.946,266.776,291.31,253.95z M256,154.483c2.985,0,5.921,0.167,8.828,0.405v89.97c-1.668-0.514-3.327-1.033-5.009-1.539c-4.502-1.355-8.652-2.679-12.647-3.994v-84.437C250.079,154.649,253.015,154.483,256,154.483z M189.793,191.448c0-12.562,12.62-24.118,30.897-30.856v68.591C198.004,218.632,189.793,207.616,189.793,191.448z M256,357.517c-2.985,0-5.921-0.167-8.828-0.405v-89.97c1.668,0.514,3.327,1.033,5.009,1.539c4.502,1.355,8.652,2.679,12.647,3.994v84.437C261.921,357.351,258.985,357.517,256,357.517z M291.31,351.407v-68.591c22.686,10.552,30.897,21.568,30.897,37.736C322.207,333.113,309.587,344.67,291.31,351.407z';

export default function CoinIcon({
  size = '1em',
  color = '#ffdc64',
  symbol = true,
  label = null,
  className = '',
}) {
  const titleId = `coin-${useId().replace(/[^a-zA-Z0-9]/g, '')}-title`;
  // The source ladder, as lightness: rim .70, ring .66, face .76, symbol .62.
  const rim = color;
  const ring = relight(color, 0.62);
  const face = relight(color, 0.78);
  const struck = relight(color, 0.55);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 512 512"
      className={`coin-icon${className ? ` ${className}` : ''}`}
      {...(label
        ? { role: 'img', 'aria-labelledby': titleId }
        : { 'aria-hidden': 'true', focusable: 'false' })}
    >
      {label && <title id={titleId}>{label}</title>}
      <circle cx="256" cy="256" r="256" fill={rim} />
      <circle cx="256" cy="256" r="220.69" fill={ring} />
      <circle cx="256" cy="256" r="194.207" fill={face} />
      {symbol && <path fill={struck} d={SYMBOL_PATH} />}
    </svg>
  );
}
