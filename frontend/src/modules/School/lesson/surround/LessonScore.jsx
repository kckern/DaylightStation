// frontend/src/modules/School/lesson/surround/LessonScore.jsx
//
// THE PLACARD. Avatar, name, and how far through the questions this child is.
// Its first job is ATTRIBUTION, made visible: a lesson dispatched to the living
// room shows up on a television that belongs to the whole family, and the child
// watching it should be able to see, without asking, that it is theirs.
//
// A SCHOOL MODULE REGISTERED INTO SURROUND — see `registerLessonSurround.js`
// and `CheckpointMap.jsx`'s header for the boundary and the ONE RULE both
// modules honour: if the chrome cannot render, it renders nothing, and the
// lesson still plays gated.
//
// WHAT IS DELIBERATELY NOT ON IT
// ------------------------------
// The ATTEMPT COUNT. It is carried — the element has it, the log event has it,
// and the backend has it durably from `RecordCheckpointAnswer` — and it is
// never painted. Two reasons, and the second is the load-bearing one:
//
//   1. The lesson is retry-until-correct. Every checkpoint ends in a ✓, so
//      attempts measures how long it took, not what was learned. There is
//      nothing the child can do with the number at the moment they can read it.
//   2. This is a television in a shared family room. A visible running total of
//      wrong answers is a public record of one child's struggle, readable by any
//      sibling who wanders past, attached to a face and a name by the very
//      attribution this placard exists to provide. Making the work visible is
//      the point; making the failures visible is a different thing that nobody
//      asked for.
//
// So the visible surface is IDENTICAL for a clean run and for a hard one, and
// `LessonScore.test.jsx` pins that rather than trusting it.
//
// WHAT IT SHOWS BEFORE THE FIRST QUESTION
// ---------------------------------------
// The whole placard, with a zero. Attribution does not wait for a score — a
// placard that appeared at the first checkpoint would be missing for the first
// several minutes, which is exactly when a child is deciding whether this
// lesson is theirs. "0 of 4" is a true statement about a lesson that has not
// reached its first stop, and it doubles as a count of what is coming.
//
// Module contract: { position, duration, playing, seeking, data, region, logger }.

/* eslint-disable react-refresh/only-export-components --
   The PURE decision lives beside the component it describes: `WorkPlacard`
   exports `plateText`, `SegmentMap` exports its splitters, and a reader looking
   for what this module decides looks in this file. The cost is fast-refresh
   granularity in dev, which the surround modules have already all accepted. */

import React, { useEffect, useMemo } from 'react';
import PropTypes from 'prop-types';
import ProfileAvatar from '../../../../lib/identity/ProfileAvatar.jsx';
import {
  lessonSurroundLogger, lessonOf, clearedSetOf, checkpointIdOf, checkpointAtOf,
} from './lessonSurroundKit.js';
import './LessonScore.scss';

const usableString = (v) => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null);
const countOr = (v, fallback) => (Number.isFinite(v) && v >= 0 ? v : fallback);

/**
 * WHAT THE PLACARD SAYS, as a pure function. Null means there is nothing to
 * attribute and therefore no placard — see the component.
 *
 * `correct` / `total` are preferred from the payload when the session carries
 * them, because a checkpoint may hold more than one ITEM and the session is the
 * only party that knows how many were answered. The checkpoint arithmetic —
 * cleared checkpoints out of placeable ones — is the fallback, and it is the
 * honest one for the shape every shipped lesson has today: one item per stop.
 *
 * @param {object|null} lesson the payload's lesson block.
 * @returns {{id: string|null, name: string, correct: number, of: number, attempts: number}|null}
 */
export function scoreModel(lesson) {
  if (!lesson || typeof lesson !== 'object') return null;
  const who = lesson.learner;
  if (!who || typeof who !== 'object' || Array.isArray(who)) return null;
  const id = usableString(who.id);
  const name = usableString(who.name) ?? usableString(who.displayName) ?? id;
  // NO NAME AND NO ID IS NOT A LEARNER. A placard reading "0 of 4" with nobody
  // on it attributes the lesson to whoever is in the room, which is the exact
  // mis-credit the session hook freezes `learnerRef` to prevent.
  if (!name) return null;

  const list = Array.isArray(lesson.checkpoints) ? lesson.checkpoints : [];
  const cleared = clearedSetOf(lesson.cleared ?? lesson.clearedIds);
  let placeable = 0;
  let done = 0;
  for (const raw of list) {
    const at = checkpointAtOf(raw);
    if (at === null) continue;
    placeable += 1;
    if (cleared.has(checkpointIdOf(raw, at))) done += 1;
  }

  return {
    id,
    name,
    correct: countOr(lesson.correct, done),
    of: countOr(lesson.total, placeable),
    attempts: countOr(lesson.attempts, 0),
  };
}

export default function LessonScore({
  // eslint-disable-next-line no-unused-vars -- part of the fixed module contract
  position = 0,
  // eslint-disable-next-line no-unused-vars -- part of the fixed module contract
  duration = 0,
  // eslint-disable-next-line no-unused-vars -- part of the fixed module contract
  playing = false,
  // eslint-disable-next-line no-unused-vars -- part of the fixed module contract
  seeking = false,
  data = null,
  // eslint-disable-next-line no-unused-vars -- part of the fixed module contract
  region = null,
  logger = null,
}) {
  const log = useMemo(() => lessonSurroundLogger(logger, 'lesson-score'), [logger]);
  const contentId = data?.contentId ?? null;
  const score = scoreModel(lessonOf(data));

  const learnerId = score?.id ?? null;
  const correct = score?.correct ?? null;
  const of = score?.of ?? null;
  const attempts = score?.attempts ?? null;

  // Edge-logged: once per learner, and again when the tally moves. The playhead
  // is not a dependency, so this is a handful of events per lesson rather than
  // ten a second.
  useEffect(() => {
    if (!score) {
      log.warn('school.surround.score.unattributed', { contentId });
      return;
    }
    log.info('school.surround.score.attributed', {
      contentId, learnerId, correct, of, attempts,
    });
    // `score` is rebuilt every render; the scalars above are what actually
    // changed, which is why they are the dependencies and it is not.
  }, [learnerId, correct, of, attempts, contentId, log]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!score) return null;

  return (
    <div
      className="lesson-score"
      data-testid="lesson-score"
      data-correct={String(score.correct)}
      data-of={String(score.of)}
      // Carried, never painted — see the header.
      data-attempts={String(score.attempts)}
    >
      <span className="lesson-score__avatar">
        <ProfileAvatar id={score.id} name={score.name} size={96} />
      </span>
      <span className="lesson-score__who">
        <span className="lesson-score__name" data-testid="lesson-score-name">{score.name}</span>
        <span className="lesson-score__tally" data-testid="lesson-score-tally">
          <span className="lesson-score__mark" aria-hidden="true">✓</span>
          <span className="lesson-score__correct">{score.correct}</span>
          <span className="lesson-score__of">{`of ${score.of}`}</span>
        </span>
      </span>
    </div>
  );
}

LessonScore.propTypes = {
  position: PropTypes.number,
  duration: PropTypes.number,
  playing: PropTypes.bool,
  seeking: PropTypes.bool,
  data: PropTypes.object,
  region: PropTypes.object,
  logger: PropTypes.object,
};
