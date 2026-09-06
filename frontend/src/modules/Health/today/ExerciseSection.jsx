import { useState } from 'react';
import { UnstyledButton } from '@mantine/core';
import { IconArrowUpRight, IconBarbell, IconHeart } from '@tabler/icons-react';
import { ContentDisplayUrl } from '../../../lib/api.mjs';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { sumCounted } from '@shared-contracts/nutrition/countedRows.mjs';

const logger = createAppLogger('health').child('exercise');

function ExerciseRow({ workout, linked }) {
  const [brokenPoster, setBrokenPoster] = useState(null);
  const segment = linked?.segments?.find(item => String(item.sessionId) === String(workout.homeSessionId));
  const media = segment?.media?.primary || linked?.media?.primary;
  const poster = media?.grandparentId ? ContentDisplayUrl(media.grandparentId) : null;
  const title = workout.title || workout.type || 'Workout';
  const minutes = workout.minutes ?? workout.duration_min;
  const href = linked ? `/fitness/home/session-${encodeURIComponent(linked.sessionId)}` : null;
  return <div className="health-exercise">
    <span className="health-exercise__art">
      {poster && brokenPoster !== poster ? <img src={poster} alt={media.showTitle ? `${media.showTitle} poster` : 'Workout program poster'} loading="lazy"
        onError={() => { setBrokenPoster(poster); logger.debug('poster_unavailable', { sessionId: linked.sessionId }); }} /> : <IconBarbell size={24} aria-hidden="true" />}
    </span>
    <div className="health-exercise__body">
      <span className="health-exercise__title">{title}</span>
      <div className="health-exercise__meta">
        {workout.startTime ? <span>{workout.startTime}</span> : null}
        {minutes > 0 ? <span>{Math.round(minutes)} min</span> : null}
        {workout.avgHeartrate > 0 ? <span title="Average heart rate"><IconHeart size={13} aria-hidden="true" />{Math.round(workout.avgHeartrate)} bpm avg</span> : null}
      </div>
    </div>
    <div className="health-exercise__result">
      <span className="health-row__kcal">+{Math.round(workout.calories || 0)}<small> kcal</small></span>
      {href ? <a className="health-exercise__link" href={href} aria-label={`View fitness session: ${title}`}
        onClick={() => logger.info('session_open', { sessionId: linked.sessionId })}>View session <IconArrowUpRight size={14} aria-hidden="true" /></a> : null}
    </div>
  </div>;
}

export function ExerciseSection({ date, sessions }) {
  // One lightweight day index supplies verified links and program artwork.
  // Nutrition's workout ledger remains the authority for calorie credit.
  const needsLinks = date && sessions.some(workout => workout.homeSessionId);
  const details = useApiResource(needsLinks ? `api/v1/fitness/sessions?date=${encodeURIComponent(date)}` : null,
    { swr: true, label: 'Workout details', logger });
  const homeSessions = details.data?.sessions || [];
  return <section className="health-meal health-meal--exercise">
    <header className="health-meal__header">
      <h4 className="health-meal__label">Exercise</h4>
      <span className="health-meal__kcal">{sessions.length ? `+${Math.round(sumCounted(sessions, 'calories'))} kcal` : '—'}</span>
    </header>
    {sessions.map((workout, index) => <ExerciseRow key={workout.id ?? `${date}-${index}`} workout={workout}
      linked={homeSessions.find(session => workout.homeSessionId && (String(session.sessionId) === String(workout.homeSessionId)
        || session.segments?.some(segment => String(segment.sessionId) === String(workout.homeSessionId))))} />)}
    {details.error ? <UnstyledButton className="health-exercise__retry" onClick={details.reload}>Workout details unavailable · Retry</UnstyledButton> : null}
  </section>;
}
