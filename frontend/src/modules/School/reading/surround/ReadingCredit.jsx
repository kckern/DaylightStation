// frontend/src/modules/School/reading/surround/ReadingCredit.jsx
//
// THE READING RAIL. Who is getting credit for this story, what it counts
// toward, and how far through the day they are.
//
// WHY IT EXISTS
// -------------
// A child scans their card, the TV asks what they want to read, they pick a
// book off a shelf of covers — and then, the moment it plays, the screen used
// to forget all of it. The story ran in a bare `Player`, visually identical to
// somebody putting on a cartoon. The shelf makes a promise — *we know who you
// are and what this counts toward* — and dropping it the instant the video
// starts is worse than never making it, because a promise set up and dropped is
// what teaches a child that the ceremony is decoration.
//
// So this rail is not ornament. It is the middle act of one ceremony, and its
// whole job is to keep saying, for the length of the story, the thing the shelf
// already said.
//
// A SCHOOL MODULE REGISTERED INTO SURROUND — see `registerReadingSurround.js`
// for the boundary, and `LessonScore.jsx` for the sibling that established it.
// THE ONE RULE binds here as it does there: if the chrome cannot render, it
// renders nothing, and the story still plays. Nothing below may throw on a
// missing field, and every absence has a defined empty answer.
//
// WHAT IS DELIBERATELY NOT ON IT
// ------------------------------
// THE TITLE, as words. The book is present as its COVER — the same artwork the
// child just picked off the shelf, which is what ties this act to the last one
// — but the title is not written out. The pick screen showed it in 6vh type
// seconds ago and the story itself opens on it; a third copy in a narrow rail
// is the kind of completeness that reads as clutter. The title becomes the
// cover's `alt`, and it is drawn ONLY when there is no cover to draw instead.
//
// THE CLOCK. Position and duration arrive on every module (10 Hz while
// playing) and are used for nothing here. A countdown is a pressure the reading
// session deliberately does not apply — a child may re-listen, wander off and
// come back, and the obligation is a count of books, never of minutes.
//
// Module contract: { position, duration, playing, seeking, data, region, logger }.

import { useEffect, useMemo } from 'react';
import PropTypes from 'prop-types';
import ProfileAvatar from '../../../../lib/identity/ProfileAvatar.jsx';
import ReadingPips from '../ReadingPips.jsx';
import { readingSurroundLogger, readingOf } from './readingSurroundKit.js';
import './ReadingCredit.scss';

/**
 * The subject, as a short label. Not defaulted and not guessed: story time's
 * subject is a fact about this household's curriculum, authored on the
 * enrollment entry (`StoryTimeProgramLauncher#enrollmentFor`). A learner whose
 * household authored none gets no subject line rather than a plausible one.
 */
function subjectLabel(subject) {
  if (typeof subject !== 'string') return null;
  const trimmed = subject.trim();
  if (!trimmed) return null;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export default function ReadingCredit({
  // eslint-disable-next-line no-unused-vars -- part of the fixed module contract
  position = 0,
  // eslint-disable-next-line no-unused-vars -- part of the fixed module contract
  duration = 0,
  // eslint-disable-next-line no-unused-vars -- part of the fixed module contract
  playing = false,
  // eslint-disable-next-line no-unused-vars -- part of the fixed module contract
  seeking = false,
  data = null,
  region = null,
  logger = null,
}) {
  const log = useMemo(() => readingSurroundLogger(logger, 'reading-credit'), [logger]);
  const reading = readingOf(data);

  const learnerId = reading?.learnerId ?? null;
  const name = reading?.learnerName ?? null;
  const subject = subjectLabel(reading?.subject);
  const cover = reading?.image ?? null;
  const title = reading?.title ?? null;

  // ATTRIBUTION IS THE WHOLE POINT, so the bar for rendering is a learner and
  // nothing else. A rail with a face and no progress still answers "is this
  // mine?"; a rail with progress and no face answers nothing worth the width.
  const usable = Boolean(learnerId);

  useEffect(() => {
    if (!usable) {
      log.debug?.('reading.surround.idle', { reason: 'no-learner', contentId: reading?.contentId ?? null });
      return;
    }
    log.info?.('reading.surround.mounted', {
      learnerId,
      contentId: reading?.contentId ?? null,
      subject: reading?.subject ?? null,
      hasCover: Boolean(cover),
      slot: region?.slot ?? null,
    });
  }, [usable, learnerId, cover, region?.slot, reading?.contentId, reading?.subject, log]);

  if (!usable) return null;

  return (
    <section className="reading-credit" data-testid="surround-reading-credit">
      <div className="reading-credit__who">
        <div className="reading-credit__avatar">
          <ProfileAvatar id={learnerId} name={name || learnerId} size={128} />
        </div>
        {name ? <p className="reading-credit__name" data-testid="reading-credit-name">{name}</p> : null}
        {subject ? (
          <p className="reading-credit__subject" data-testid="reading-credit-subject">{subject}</p>
        ) : null}
      </div>

      {/* The book, as its cover. Falls back to the title only when there is no
          artwork — a rail with a blank plate where the book should be says less
          than one that names it. */}
      {cover ? (
        <div className="reading-credit__book">
          <img className="reading-credit__cover" src={cover} alt={title || 'The book being read'} />
        </div>
      ) : title ? (
        <p className="reading-credit__title" data-testid="reading-credit-title">{title}</p>
      ) : null}

      <div className="reading-credit__progress">
        <ReadingPips
          count={reading?.count}
          target={reading?.target}
          label={reading?.progressLabel}
          className="reading-credit__pips"
          testId="reading-credit-count"
        />
      </div>
    </section>
  );
}

ReadingCredit.propTypes = {
  position: PropTypes.number,
  duration: PropTypes.number,
  playing: PropTypes.bool,
  seeking: PropTypes.bool,
  data: PropTypes.object,
  region: PropTypes.object,
  logger: PropTypes.object,
};
