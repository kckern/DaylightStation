/**
 * PeriodsTimeline — the configured academic calendar, current period marked
 * (startsAt <= now < endsAt, resolved client-side the same way the student
 * panel does). Editing awaits the config→data promotion (stub).
 */
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import PanelFrame from './PanelFrame.jsx';

const day = (iso) => (typeof iso === 'string' ? iso.slice(0, 10) : '');

export default function PeriodsTimeline() {
  const periods = usePanelFetch(() => schoolApi.periods(), { panel: 'periods' });
  const now = Date.now();
  return (
    <PanelFrame title="Academic periods" state={periods.state} retry={periods.retry} emptyCopy="No academic periods configured.">
      <ol className="teacher-periods">
        {(periods.data ?? []).map((p) => {
          const current = Date.parse(p.startsAt) <= now && now < Date.parse(p.endsAt);
          return (
            <li key={p.periodId} className="teacher-periods__period" data-current={current ? '' : undefined}>
              <span className="teacher-periods__label">{p.label}</span>
              <span className="teacher-periods__range">{day(p.startsAt)} → {day(p.endsAt)}</span>
              {current && <span className="teacher-periods__now">current</span>}
            </li>
          );
        })}
      </ol>
    </PanelFrame>
  );
}
