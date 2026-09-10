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
// THE BOOK, in any form. The rail used to carry the cover, and the stage
// carries the cover too — the same artwork twice on one screen, once at 78% of
// a narrow rail and once at full size a foot to its right. The rail's copy was
// the one adding nothing: the stage's is bigger, is what the child picked off
// the shelf, and is unmissable. So the rail answers only the questions the
// stage cannot — WHOSE this is and HOW FAR THROUGH THE DAY they are — and the
// title, likewise, is never written out here.
//
// A CLOCK, as words or as a bar. Position and duration arrive on every module
// (10 Hz while playing) and drive exactly one thing: the sweep on the live pip.
// No countdown, no elapsed/total, no bar. A countdown is a pressure the reading
// session deliberately does not apply — a child may re-listen, wander off and
// come back, and the obligation is a count of books, never of minutes. The
// sweep is a different statement: it says which book is in flight, not how long
// is left to endure.
//
// Module contract: { position, duration, playing, seeking, data, region, logger }.

import { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import ProfileAvatar from '../../../../lib/identity/ProfileAvatar.jsx';
import Icon from '../../home/icons/Icon.jsx';
import { hasIcon } from '../../home/icons/iconRegistry.js';
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

/**
 * The wall clock and the date — J9, the one job on this rail that nothing
 * depends on.
 *
 * IT IS A CLOCK, NOT A COUNTDOWN. The rail deliberately refuses to say how long
 * is left in a story (see the header): that is a pressure this session does not
 * apply. The time of day is a different object — it is about the room, not the
 * book, and it is here for one reason only, which is that a child who looks up
 * from a story gets to practise reading it.
 *
 * Which is also the rule that keeps it honest: the moment anything on this
 * screen DEPENDS on the time, it has stopped being incidental and has to be
 * designed as an affordance instead.
 *
 * Ticks once a minute, on the minute. No seconds — a digit changing every
 * second is motion, and the pulse on the live pip is the only motion this
 * screen gets.
 */
function WallClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer = null;
    const schedule = () => {
      // Align to the next minute boundary rather than drifting on a 60s
      // interval, so the rail and the kitchen clock agree.
      const ms = 60_000 - (Date.now() % 60_000);
      timer = setTimeout(() => { setNow(new Date()); schedule(); }, ms + 50);
    };
    schedule();
    return () => { if (timer) clearTimeout(timer); };
  }, []);

  // No AM/PM: it is a second code to learn, and a child knows whether it is
  // morning. No leading zero, no seconds.
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })
    .format(now).replace(/\s*[AP]M$/i, '');
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(now);
  const date = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric' }).format(now);

  return (
    <div className="reading-credit__clock" data-testid="reading-credit-clock">
      <p className="reading-credit__time">{time}</p>
      <p className="reading-credit__date">{weekday}</p>
      <p className="reading-credit__date">{date}</p>
    </div>
  );
}

/**
 * The subject as its own MARK, above the child rather than beneath them.
 *
 * TWO IDENTITIES, NOT ONE. The subject word used to sit directly under the
 * portrait, in the position a caption occupies — so the rail read as a child
 * called "English". They are different facts about different things: the
 * subject is what this session counts toward, the face and the name are who is
 * getting the credit. The subject now leads the column with the same icon the
 * subject wall uses, and the child's own caption is their NAME.
 */
function subjectIcon(subject) {
  if (typeof subject !== 'string') return null;
  const id = subject.trim().toLowerCase();
  return id && hasIcon(id) ? id : null;
}

export default function ReadingCredit({
  position = 0,
  duration = 0,
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
  const mark = subjectIcon(reading?.subject);

  // How far through THIS story, for the live pip. The module contract already
  // delivers both numbers at 10 Hz; they were previously used for nothing here
  // (see the header's note on the clock, which held while the Player drew its
  // own bar). A duration of 0 is "not known yet", never "at the start".
  const fraction = duration > 0 && position >= 0 ? position / duration : null;

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
      hasName: Boolean(name),
      hasSubjectIcon: Boolean(mark),
      slot: region?.slot ?? null,
    });
  }, [usable, learnerId, name, mark, region?.slot, reading?.contentId, reading?.subject, log]);

  if (!usable) return null;

  return (
    <section className="reading-credit" data-testid="surround-reading-credit">
      {/* What this counts toward, as a mark. Its own thing, above the child. */}
      {mark || subject ? (
        <div className="reading-credit__subject" data-testid="reading-credit-subject">
          {mark ? <Icon name={mark} className="reading-credit__subject-icon" label={subject || undefined} /> : null}
          {subject ? <p className="reading-credit__subject-name">{subject}</p> : null}
        </div>
      ) : null}

      {/* Who is getting the credit. The name is the caption on the face. */}
      <div className="reading-credit__who">
        <div className="reading-credit__avatar">
          <ProfileAvatar id={learnerId} name={name || learnerId} size={256} />
        </div>
        {name ? <p className="reading-credit__name" data-testid="reading-credit-name">{name}</p> : null}
      </div>

      <div className="reading-credit__progress">
        <ReadingPips
          count={reading?.count}
          target={reading?.target}
          label={reading?.progressLabel}
          className="reading-credit__pips"
          testId="reading-credit-count"
          // A PAUSED story is still in flight. Gating the live pip on `playing`
          // made it vanish the moment anyone hit pause, taking the "which book
          // is this" answer with it — so the mark is on whenever there is a
          // story loaded, and only the PULSE stops when the audio does.
          live={playing || duration > 0}
          moving={playing}
          progress={fraction}
        />
      </div>

      {/* UP NEXT: the book waiting on deck, and WHOSE it is — cover, face,
          name. The queue is user-scoped, and this is where a child sees that
          the book they queued is theirs, or that a sibling's card just took it.
          Small and below the plaque: it is a promise about later, not a fact
          about now. */}
      {reading?.onDeck ? (
        <div className="reading-credit__next" data-testid="reading-credit-next">
          <p className="reading-credit__next-label">Up next</p>
          <div className="reading-credit__next-card">
            {reading.onDeck.image
              ? <img className="reading-credit__next-cover" src={reading.onDeck.image} alt="" />
              : <span className="reading-credit__next-cover reading-credit__next-cover--blank" aria-hidden="true" />}
            {reading.onDeck.learnerId ? (
              <div className="reading-credit__next-who">
                <div className="reading-credit__next-face">
                  <ProfileAvatar id={reading.onDeck.learnerId} name={reading.onDeck.learnerName || reading.onDeck.learnerId} size={96} />
                </div>
                {reading.onDeck.learnerName ? <p className="reading-credit__next-name">{reading.onDeck.learnerName}</p> : null}
              </div>
            ) : null}
          </div>
          {reading.onDeck.title ? <p className="reading-credit__next-title">{reading.onDeck.title}</p> : null}
        </div>
      ) : null}

      {/* Anchored to the foot of the rail, visibly OUTSIDE the plaque above it:
          J9 costs nothing only while it is not part of the statement. */}
      <WallClock />
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
