import { sharedPrefix, courseStats } from './subcourses.js';
import ProgressRing from './ProgressRing.jsx';

const TINTS = ['var(--psc-tint-1)', 'var(--psc-tint-2)', 'var(--psc-tint-3)', 'var(--psc-tint-4)'];
const ord = (n) => String(n).padStart(2, '0');

export default function CourseCards({ season, currentFloor = null, onSelect }) {
  const courses = season?.courses || [];
  const { prefix, tails } = sharedPrefix(courses.map((c) => c.label));
  const tint = TINTS[(((season?.index ?? 0) % TINTS.length) + TINTS.length) % TINTS.length];
  return (
    <ul className="psc-cards">
      {courses.map((c, i) => {
        const st = courseStats(c);
        const isCurrent = c.floor === currentFloor;
        const tail = tails[i] || c.label;
        return (
          <li key={c.floor}>
            <button type="button" className={`psc-card${isCurrent ? ' is-current' : ''}${c.reference ? ' psc-card--resource' : ''}`}
              style={{ '--tint': tint }} onClick={() => onSelect(c)} title={c.label}>
              <span className="psc-card__tint" />
              <span className="psc-card__top">
                <span className="psc-card__idx">{ord(c.floor)}</span>
                <span className="psc-card__wm">
                  {prefix && <span className="psc-card__pfx">{prefix}</span>}
                  <span className="psc-card__tail">{tail}</span>
                </span>
                {!c.reference && <ProgressRing percent={st.percent} label={`${st.watched}/${st.total}`} done={st.complete} />}
              </span>
              <span className="psc-card__foot">
                <span className="psc-card__sub">{c.reference ? 'open anytime' : `${st.total} lesson${st.total === 1 ? '' : 's'}`}</span>
                {c.reference ? <span className="psc-tag psc-tag--res">resource</span>
                  : isCurrent ? <span className="psc-tag psc-tag--next">up next</span>
                  : st.complete ? <span className="psc-tag psc-tag--done">done</span>
                  : <span className="psc-tag psc-tag--later">later</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
