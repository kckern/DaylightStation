import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fitFontSize } from './fitFontSize.js';
import { wordLadderLog } from './wordLadderLog.js';

const ROLES = { term: [32, 120, 2], gloss: [28, 88, 3], choice: [22, 48, 2], prompt: [28, 96, 3] };
const GroupContext = createContext(null);

/** Siblings share the smallest fitted size (the four choices), so length never hints at the answer. */
export function FitGroup({ children }) {
  const [sizes, setSizes] = useState({});
  const value = useMemo(() => ({
    report: (id, px) => setSizes((prev) => (prev[id] === px ? prev : { ...prev, [id]: px })),
    size: Object.values(sizes).length ? Math.min(...Object.values(sizes)) : null,
  }), [sizes]);
  return <GroupContext.Provider value={value}>{children}</GroupContext.Provider>;
}

export function FitText({ role = 'term', text, lang, className = '' }) {
  const ref = useRef(null);
  const group = useContext(GroupContext);
  const id = useMemo(() => Math.random().toString(36).slice(2), []);
  const [own, setOwn] = useState(ROLES[role][0]);
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const [min, max, maxLines] = ROLES[role];
    const fit = () => {
      const box = el.parentElement.getBoundingClientRect();
      const result = fitFontSize({
        min, max,
        measure: (px) => {
          el.style.fontSize = `${px}px`;
          const lineHeight = px * 1.15;
          return { fits: el.scrollWidth <= box.width + 0.5 && el.scrollHeight <= Math.min(box.height, lineHeight * maxLines) + 0.5 };
        },
      });
      setOwn(result.px); setClamped(result.clamped);
      group?.report(id, result.px);
      if (result.clamped) wordLadderLog.layoutClamped({ role, text, width: Math.round(box.width), height: Math.round(box.height) });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el.parentElement);
    document.fonts?.ready?.then(fit);
    return () => observer.disconnect();
  }, [role, text, group, id]);
  const px = group?.size ?? own;
  return (
    <span ref={ref} lang={lang} className={`wl-fit wl-fit--${role}${clamped ? ' wl-fit--clamped' : ''} ${className}`.trim()} style={{ fontSize: `${px}px` }}>
      {text}
    </span>
  );
}
