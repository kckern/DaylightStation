// FitnessMomentum.jsx
import React, { useMemo } from 'react';
import { useScreenData } from '@/screen-framework/data/ScreenDataProvider.jsx';
import { useFitnessScreen } from '@/modules/Fitness/FitnessScreenProvider.jsx';
import getLogger from '@/lib/logging/Logger.js';
import { computeMomentum } from './momentum.js';
import './FitnessMomentum.scss';

const logger = getLogger().child({ component: 'fitness-momentum' });

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
  const { roster, householdLabel } = useFitnessScreen();

  const data = useMemo(
    () => computeMomentum(sessions, roster, { householdLabel }),
    [sessions, roster, householdLabel],
  );

  logger.sampled('momentum.render', { members: data.members.length, householdMin: data.household.activeMinutes },
    { maxPerMinute: 12, aggregate: true });

  const { household, members } = data;
  const anyActive = household.activeMinutes > 0;

  return (
    <div className="fitness-momentum">
      <div className="fitness-momentum__headline">
        <span className="fitness-momentum__flame">🔥</span>
        <span className="fitness-momentum__house">{household.label}</span>
        {household.streakDays > 0 && (
          <span className="fitness-momentum__roll">· {household.streakDays}-day roll</span>
        )}
        <span className="fitness-momentum__house-min">{household.activeMinutes} / {household.goalMinutes} min</span>
        <span className="fitness-momentum__bar fitness-momentum__bar--house">
          <span className="fitness-momentum__bar-fill" style={{ transform: `scaleX(${household.pct})` }} />
        </span>
      </div>

      {!anyActive && (
        <div className="fitness-momentum__zero">Let’s get moving — log a workout to start the week.</div>
      )}

      <div className="fitness-momentum__cards">
        {members.map((m) => (
          <div key={m.id} className={`fitness-momentum__card${m.met ? ' is-met' : ''}`}>
            <Avatar id={m.avatarId} name={m.name} />
            <span className="fitness-momentum__name">{m.name}</span>
            <span className="fitness-momentum__streak">🔥 {m.streakDays}</span>
            <span className="fitness-momentum__min">{m.activeMinutes} / {m.goalMinutes}{m.met ? ' ✓' : ''}</span>
            <span className="fitness-momentum__bar">
              <span className="fitness-momentum__bar-fill" style={{ transform: `scaleX(${m.pct})` }} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
