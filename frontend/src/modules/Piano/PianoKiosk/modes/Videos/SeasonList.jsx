import { seasonStats } from './subcourses.js';
import ProgressRing from './ProgressRing.jsx';

const TINTS = ['var(--psc-tint-1)', 'var(--psc-tint-2)', 'var(--psc-tint-3)', 'var(--psc-tint-4)'];
const tintFor = (i) => TINTS[((i % TINTS.length) + TINTS.length) % TINTS.length];
const ord = (n) => String(n).padStart(2, '0');

export default function SeasonList({ seasons, onSelect }) {
  return (
    <ul className="psc-list">
      {(seasons || []).map((s, i) => {
        const name = s.title || `Season ${s.index}`;
        const tint = tintFor(i);
        if ((s.piano?.lane || s.piano?.category) === 'repertoire') {
          return (
            <li key={s.id}>
              <button type="button" className="psc-row psc-row--songs" style={{ '--tint': tint }} onClick={() => onSelect(s)} title={name}>
                <span className="psc-row__tint" />
                <span className="psc-row__resmark" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                </span>
                <span className="psc-row__meta"><span className="psc-row__name">{name}</span>
                  <span className="psc-row__sub">{s.lessons.length} lessons · browse by song</span></span>
                <span className="psc-tag psc-tag--res">song library</span>
              </button>
            </li>
          );
        }
        if (s.reference) {
          return (
            <li key={s.id}>
              <button type="button" className="psc-row psc-row--resource" style={{ '--tint': tint }} onClick={() => onSelect(s)} title={name}>
                <span className="psc-row__tint" />
                <span className="psc-row__resmark" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M6 4h11a1 1 0 011 1v15l-6.5-3.5L6 20V5a1 1 0 011-1z" /></svg>
                </span>
                <span className="psc-row__meta"><span className="psc-row__name">{name}</span>
                  <span className="psc-row__sub">{s.courses.length} resource{s.courses.length === 1 ? '' : 's'} · open anytime</span></span>
                <span className="psc-tag psc-tag--res">always on</span>
              </button>
            </li>
          );
        }
        const st = seasonStats(s);
        return (
          <li key={s.id}>
            <button type="button" className="psc-row" style={{ '--tint': tint }} onClick={() => onSelect(s)} title={name}>
              <span className="psc-row__tint" />
              <ProgressRing percent={st.percent} label={`${st.percent}%`} done={st.totalCourses > 0 && st.completeCourses === st.totalCourses} />
              <span className="psc-row__idx">{ord(s.index)}</span>
              <span className="psc-row__meta"><span className="psc-row__name">{name}</span>
                <span className="psc-row__sub">{st.totalCourses} course{st.totalCourses === 1 ? '' : 's'}{st.completeCourses ? ` · ${st.completeCourses} done` : ''}</span></span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
