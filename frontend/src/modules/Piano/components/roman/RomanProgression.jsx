import { parseRoman } from './parseRoman.js';
import './RomanProgression.scss';

/** One roman-numeral chord, quality encoded by case + symbol, figure as superscript. */
export function RomanChord({ token, active = false }) {
  const { accidental, numeral, quality, figure } = parseRoman(token);
  return (
    <span className={`roman-chord${active ? ' is-active' : ''}`} data-quality={quality}>
      {accidental && <span className="roman-chord__acc">{accidental}</span>}
      <span className="roman-chord__num">{numeral}</span>
      {figure && <sup className="roman-chord__fig">{figure}</sup>}
    </span>
  );
}

/**
 * A progression rendered as chips (default) or an inline hairline-separated run.
 * @param {{roman:string[], activeIndex?:number, inline?:boolean}} props
 */
export function RomanProgression({ roman = [], activeIndex = -1, inline = false }) {
  if (!roman.length) return null;
  return (
    <span className={`roman-progression${inline ? ' roman-progression--inline' : ''}`}>
      {roman.map((token, i) => (
        <RomanChord key={`${token}-${i}`} token={token} active={i === activeIndex} />
      ))}
    </span>
  );
}

export default RomanProgression;
