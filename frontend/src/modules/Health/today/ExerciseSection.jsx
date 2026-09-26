import { useMemo, useState } from 'react';
import { UnstyledButton } from '@mantine/core';
import { IconBarbell, IconMicrophone } from '@tabler/icons-react';
import { ContentDisplayUrl } from '../../../lib/api.mjs';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { sumCounted } from '@shared-contracts/nutrition/countedRows.mjs';
import { isCoarsePointer, useRowPreview } from './RowPreview.jsx';

const logger = createAppLogger('health').child('exercise');

const ESTIMATE_NOTE = 'Estimated from heart rate; not on Strava yet';
const credit = workout => `+${workout.estimated ? '~' : ''}${Math.round(workout.calories || 0)}`;

// The card behind a row: everything the row leaves out.
function ExercisePreviewContent({ workout, title, minutes, poster, memos, description }) {
  return <div className="health-row-preview health-exercise-preview">
    <div className="health-row-preview__hero health-exercise-preview__hero">
      {poster ? <img src={poster} alt="" decoding="async" /> : <IconBarbell size={32} aria-hidden="true" />}
    </div>
    <div className="health-row-preview__body">
      <p className="health-row-preview__title">{title}</p>
      <p className="health-row-preview__facts">
        {workout.startTime ? <span>{workout.startTime}</span> : null}
        {minutes > 0 ? <span>{Math.round(minutes)} min</span> : null}
        {workout.avgHeartrate > 0 ? <span>{Math.round(workout.avgHeartrate)} bpm avg</span> : null}
        <span className="health-row-preview__kcal">{credit(workout)} kcal{workout.estimated ? ' est.' : ''}</span>
      </p>
      {memos.map((text, index) => <p key={index} className="health-exercise-preview__memo">
        <IconMicrophone size={13} aria-label="Voice memo" />“{text}”</p>)}
      {description ? <p className="health-exercise-preview__description">{description}</p> : null}
    </div>
  </div>;
}

// A workout reads like a food row: poster and name on the left, minutes in the
// portion track, the credit in the kcal track. The whole row opens the session.
function ExerciseRow({ workout, linked }) {
  const [brokenPoster, setBrokenPoster] = useState(null);
  const segment = linked?.segments?.find(item => String(item.sessionId) === String(workout.homeSessionId));
  const media = segment?.media?.primary || linked?.media?.primary;
  const posterUrl = media?.grandparentId ? ContentDisplayUrl(media.grandparentId) : null;
  const poster = posterUrl && brokenPoster !== posterUrl ? posterUrl : null;
  const title = workout.title || workout.type || 'Workout';
  const minutes = workout.minutes ?? workout.duration_min;
  const href = linked ? `/fitness/home/session-${encodeURIComponent(linked.sessionId)}` : null;
  // What was said after the workout; the episode blurb only stands in when nothing was.
  const memos = useMemo(() => (linked?.voiceMemos || []).map(memo => memo?.transcript?.trim()).filter(Boolean), [linked]);
  const description = media?.description || null;
  const content = useMemo(() => ({
    node: <ExercisePreviewContent workout={workout} title={title} minutes={minutes} poster={poster} memos={memos} description={description} />,
  }), [workout, title, minutes, poster, memos, description]);
  const preview = useRowPreview({ content,
    onOpen: () => logger.sampled('preview_open', { sessionId: linked?.sessionId ?? null }, { maxPerMinute: 20 }) });

  const onPosterClick = event => {
    if (!isCoarsePointer()) return;
    event.preventDefault();
    event.stopPropagation();
    preview.onArtworkClick(event);
  };
  const Row = href ? 'a' : 'div';
  const linkProps = href ? { href, ...preview.focusProps,
    onClick: () => logger.info('session_open', { sessionId: linked.sessionId }) } : {};
  return <Row className="health-exercise" {...linkProps} {...preview.targetProps}>
    <span className="health-exercise__identity">
      <span className="health-exercise__art" data-row-preview-toggle="" onClick={onPosterClick}>
        {poster ? <img src={poster} alt={media.showTitle ? `${media.showTitle} poster` : 'Workout program poster'} loading="lazy"
          onError={() => { setBrokenPoster(poster); logger.debug('poster_unavailable', { sessionId: linked.sessionId }); }} />
          : <IconBarbell size={18} aria-hidden="true" />}
      </span>
      <span className="health-exercise__text">
        <span className="health-exercise__title">{title}</span>
        {memos[0] ? <span className="health-exercise__memo"><IconMicrophone size={12} aria-label="Voice memo" />“{memos[0]}”</span>
          : description ? <span className="health-exercise__description">{description}</span> : null}
      </span>
    </span>
    <span className="health-exercise__minutes">{minutes > 0 ? `${Math.round(minutes)} min` : ''}</span>
    <span className="health-row__kcal health-exercise__kcal" title={workout.estimated ? ESTIMATE_NOTE : undefined}>
      {credit(workout)}<small> kcal</small></span>
  </Row>;
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
      <span className="health-meal__header-right">
        <span className="health-meal__kcal">{sessions.length ? `+${Math.round(sumCounted(sessions, 'calories'))} kcal` : '—'}</span>
      </span>
    </header>
    {sessions.map((workout, index) => <ExerciseRow key={workout.id ?? `${date}-${index}`} workout={workout}
      linked={homeSessions.find(session => workout.homeSessionId && (String(session.sessionId) === String(workout.homeSessionId)
        || session.segments?.some(segment => String(segment.sessionId) === String(workout.homeSessionId))))} />)}
    {details.error ? <UnstyledButton className="health-exercise__retry" onClick={details.reload}>Workout details unavailable · Retry</UnstyledButton> : null}
  </section>;
}
