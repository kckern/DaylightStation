// FitnessMomentum.jsx — one flat glass panel: a household momentum headline plus
// a per-person row. "Effort" is HR-zone-weighted (cool omitted); the bar compares
// this window against each person's trailing 4-window average. Names resolve
// through DisplayNameResolver (group label → "Dad").
import React, { useMemo } from 'react';
import { useScreenData } from '@/screen-framework/data/ScreenDataProvider.jsx';
import { useFitnessScreen } from '@/modules/Fitness/FitnessScreenProvider.jsx';
import { resolveUserDisplayName } from '@/hooks/fitness/DisplayNameResolver.js';
import getLogger from '@/lib/logging/Logger.js';
import { computeMomentum } from './momentum.js';
import './FitnessMomentum.scss';

const logger = getLogger().child({ component: 'fitness-momentum' });

// Active → fire, low → high intensity. Drives both the legend and stack order.
const ZONE_ORDER = ['active', 'warm', 'hot', 'fire'];
const ZONE_VAR = {
  active: 'var(--zone-active)',
  warm: 'var(--zone-warm)',
  hot: 'var(--zone-hot)',
  fire: 'var(--zone-fire)',
};

/**
 * Segment widths for the stacked zone bar. The full bar represents the baseline
 * (recent norm); segments fill toward it by zone. When effort exceeds the
 * baseline the segments are scaled to fit the bar (distribution preserved) and
 * the real ratio is shown as a number alongside.
 */
function zoneSegments(zones, baselineMinutes, effortMinutes) {
  const denom = baselineMinutes > 0 ? baselineMinutes : (effortMinutes || 1);
  let segs = ZONE_ORDER.map((z) => ({ zone: z, w: (zones[z] || 0) / denom }));
  const total = segs.reduce((s, x) => s + x.w, 0);
  if (total > 1) segs = segs.map((x) => ({ ...x, w: x.w / total })); // cap to bar, keep proportions
  return segs;
}

function ZoneBar({ zones, baselineMinutes, effortMinutes }) {
  const segs = zoneSegments(zones, baselineMinutes, effortMinutes);
  return (
    <span className="fitness-momentum__bar">
      {segs.map((s) => (
        s.w > 0 ? (
          <span
            key={s.zone}
            className={`fitness-momentum__seg fitness-momentum__seg--${s.zone}`}
            style={{ width: `${(s.w * 100).toFixed(2)}%`, background: ZONE_VAR[s.zone] }}
          />
        ) : null
      ))}
    </span>
  );
}

function Avatar({ id, name }) {
  const [failed, setFailed] = React.useState(false);
  const initials = (name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  if (failed || !id) return <span className="fitness-momentum__avatar fitness-momentum__avatar--fallback">{initials}</span>;
  return <img className="fitness-momentum__avatar" src={`/api/v1/static/img/users/${id}`} alt={name} onError={() => setFailed(true)} />;
}

export default function FitnessMomentum() {
  // The 'sessions' source returns a wrapped object ({ sessions, total, ... }),
  // not a bare array (see FitnessSessionsWidget) — unwrap before computing.
  const rawSessions = useScreenData('sessions');
  const sessions = Array.isArray(rawSessions) ? rawSessions : (rawSessions?.sessions || []);
  const { roster, householdLabel, windowDays } = useFitnessScreen();

  // Short, family-friendly names via the device-agnostic resolver ("Dad" etc.).
  const nameById = useMemo(() => {
    const map = new Map();
    for (const u of (roster || [])) {
      map.set(u.id, resolveUserDisplayName(u, { preferGroupLabels: true }).displayName);
    }
    return map;
  }, [roster]);

  const data = useMemo(
    () => computeMomentum(sessions, roster, { householdLabel, windowDays }),
    [sessions, roster, householdLabel, windowDays],
  );

  logger.sampled('momentum.render', { members: data.members.length, householdMin: data.household.effortMinutes },
    { maxPerMinute: 12, aggregate: true });

  const { household, members } = data;
  const anyActive = household.effortMinutes > 0;

  return (
    <div className="fitness-momentum">
      <div className="fitness-momentum__headline">
        <span className="fitness-momentum__flame">🔥</span>
        <span className="fitness-momentum__house">{household.label}</span>
        <span className="fitness-momentum__window">· last {household.windowDays} days</span>
        <span className="fitness-momentum__house-min">
          {household.effortMinutes} min · {household.ratioPct}% of avg
        </span>
      </div>

      {!anyActive && (
        <div className="fitness-momentum__zero">Let’s get moving — no credited minutes yet this week.</div>
      )}

      <div className="fitness-momentum__cards">
        {members.map((m) => (
          <div key={m.id} className={`fitness-momentum__card${m.ahead ? ' is-ahead' : ''}`}>
            <Avatar id={m.avatarId} name={m.name} />
            <span className="fitness-momentum__name">{nameById.get(m.id) || m.name}</span>
            <span className={`fitness-momentum__ratio${m.ahead ? ' is-ahead' : ''}`}>
              {m.ratioPct}%
            </span>
            <ZoneBar zones={m.zones} baselineMinutes={m.baselineMinutes} effortMinutes={m.effortMinutes} />
            <span className="fitness-momentum__min">{m.effortMinutes} / {m.baselineMinutes} min</span>
          </div>
        ))}
      </div>
    </div>
  );
}
