/** Asset (flag) choice item. Prompt may carry a flag image; choices are text
 *  and/or flag images. Submits the chosen `value` once. Choice order is
 *  shuffled STABLY per item.id (memoized) so a verdict re-render never
 *  reshuffles the buttons under the child's finger. */
import { useEffect, useMemo, useRef } from 'react';
import { flagFor } from '../../geography/flags.js';

// Deterministic per-id shuffle (mirrors the backend seed idea; order isn't graded).
function shuffleStable(choices, seed) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i += 1) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  const rand = () => { h |= 0; h = (h + 0x6D2B79F5) | 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = choices.slice();
  for (let i = out.length - 1; i > 0; i -= 1) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

const flagImg = (image, alt) => (image?.kind === 'flag'
  ? <img className="school-choice__flag" src={flagFor(image.iso)} alt={alt} /> : null);

export default function AssetChoiceItem({ item, onSubmit, verdict }) {
  const submittedRef = useRef(false);
  useEffect(() => { submittedRef.current = false; }, [item.id]);
  const ordered = useMemo(() => shuffleStable(item.choices, item.id), [item.id, item.choices]);
  const submit = (value) => {
    if (verdict || submittedRef.current) return;
    submittedRef.current = true;
    onSubmit(value);
  };
  return (
    <div className="school-item school-item--asset">
      <p className="school-item__prompt">{item.prompt}</p>
      {item.promptImage && (
        <div className="school-item__prompt-image">{flagImg(item.promptImage, `${item.promptImage.kind} to identify`)}</div>
      )}
      <div className="school-item__choices school-item__choices--asset">
        {ordered.map((c) => {
          const cls = ['school-item__choice'];
          if (verdict) {
            if (c.value === verdict.expected) cls.push('school-item__choice--right');
            else cls.push('school-item__choice--dim');
          }
          return (
            <button key={c.value} type="button" className={cls.join(' ')} disabled={!!verdict}
              aria-label={c.label || c.value} onClick={() => submit(c.value)}>
              {flagImg(c.image, c.label || c.value)}
              {c.label && <span className="school-choice__label">{c.label}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
