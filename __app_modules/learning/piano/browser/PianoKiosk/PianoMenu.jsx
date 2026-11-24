import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import getLogger from '../../../../../frontend/src/lib/logging/Logger.js';
import { usePianoKioskConfig } from './PianoConfig.jsx';
import { gamesDisabledFor } from './gameAccessPolicy.js';
import { coursesDisabledFor } from './courseAccessPolicy.js';
import { usePianoMidi } from './PianoMidiContext.jsx';
import { usePianoUser } from './PianoUserContext.jsx';
import PianoTile from './PianoTile.jsx';
import PianoHomeDesk from './desk/PianoHomeDesk.jsx';
import LatestPieceCard from './desk/LatestPieceCard.jsx';
import { KIOSK_DEVICE_ID } from './kioskDeviceIdentity.js';
import LiveKeyboard from './LiveKeyboard.jsx';
import { balancedColumns } from './tileGridLayout.js';
import usePianoCurfew from './usePianoCurfew.js';
import useSchoolGameAccess from './useSchoolGameAccess.js';
import useKaraokeSchoolAccess from './useKaraokeSchoolAccess.js';
import { canBuyPass, canEnterLock } from './earlyPass.js';
import usePianoLessonGate, { PENDING_CAPTION } from './usePianoLessonGate.js';
import TodaysLessonGate from './TodaysLessonGate.jsx';
import { openPianoCourseLesson } from './pianoContentOpen.js';
import { PIANO_MODES } from './pianoModes.js';
import { scoreViewPath } from './modes/SheetMusic/sheetMusicModel.js';

/**
 * PianoMenu — the touch-first home screen for a piano. Tiles route to each mode.
 *
 * Under curfew (config.curfew, default 19:00–06:00) the whole menu goes dark:
 * every tile and the progress strip grey out and stops responding. The
 * one thing still working is the piano — sitting down and playing auto-enters
 * Studio (useAutoStudioEntry in PianoApp), which is deliberately independent of
 * this menu, so evening free play is unaffected.
 *
 * While the active player still owes today's assigned School piano lesson, the
 * tiles and the progress strip are REPLACED by that one lesson
 * (TodaysLessonGate) — not greyed out, which is curfew's look and would read as
 * "everything is closed" rather than "here is the one thing". It clears itself
 * when School says the day is discharged.
 *
 * Curfew does NOT cancel that lesson (owner, 2026-11-20): a child who still
 * owes the day's assigned lesson may start it at any hour of the curfew
 * window. Under curfew the lesson is the ONLY door — no progress strip, no
 * Sheet Music column, no tiles — and once School discharges the day the menu
 * falls back to the closed-for-the-night view.
 *
 * Until that verdict arrives the menu is PENDING: greyed like curfew, with one
 * caption, because nothing here is tappable *yet*. Reading `gated === false`
 * alone is what let a learner walk out through the activity strip on
 * 2026-09-01, 3.5s into an 11.1s read. A verdict of any kind — including the
 * hook's timeout and error — opens the menu; the gate must never lock a child
 * out over a fault.
 *
 * Both are render branches of THIS component, never a redirect: the auto-Studio
 * trigger arms on `pathname === menuPath`, so a child who sits down and plays
 * still lands in Studio no matter which branch is on screen. Moving either to
 * its own route would silently break that.
 */
export function PianoMenu() {
  const navigate = useNavigate();
  const { pianoId, basePath, config } = usePianoKioskConfig();
  const { pressNote, releaseNote } = usePianoMidi();
  const { users, currentUser, setCurrentUser } = usePianoUser();
  const gameAccess = useSchoolGameAccess(currentUser, {
    schoolLearner: (users || []).find((u) => u.id === currentUser)?.schoolLearner,
  });
  const karaokeAccess = useKaraokeSchoolAccess();
  const kb = config?.keyboard || { startNote: 21, endNote: 108 };
  const logger = useMemo(() => getLogger().child({ component: 'piano-menu' }), []);
  const cols = balancedColumns(PIANO_MODES.length); // 10 → 5
  // Curfew is for the piano's own tablet. A grown-up opening the page in an
  // ordinary browser is not locked out for the night.
  const onKiosk = Boolean(config?.screensaver?.deviceId) && KIOSK_DEVICE_ID === config.screensaver.deviceId;
  const curfewWindow = usePianoCurfew(config?.curfew, config?.timezone);
  const curfew = curfewWindow && onKiosk;
  // The owed lesson survives curfew; everything else the gate leaves open
  // (strip, Sheet Music column) does not. See the header.
  const lessonGate = usePianoLessonGate(currentUser);
  // Not a lock — see gameAccessPolicy.js. The tile stays PRESENT and disabled
  // rather than disappearing: a tile that vanishes for one player and not
  // another reads as a fault to a child, and invites the hunt for the way back
  // that a plain "not for you" ends.
  const gamesOff = gamesDisabledFor(config.gameAccess, currentUser);
  // Same rule for the video courses (courseAccessPolicy.js): present, disabled, "not for you".
  const coursesOff = coursesDisabledFor(config.courseAccess, currentUser);
  const gated = lessonGate.gated;
  const lessonOnly = gated && (curfew || Boolean(lessonGate.challenge));
  const curfewLessonOpen = curfew && gated;
  useEffect(() => {
    if (!curfewLessonOpen) return;
    logger.info('piano.curfew.lesson-open', {
      pianoId, userId: currentUser,
      courseId: lessonGate.course?.id ?? null,
      lessonId: lessonGate.lesson?.id ?? null,
      challengeId: lessonGate.challenge?.id ?? null,
    });
  }, [curfewLessonOpen, currentUser, lessonGate.lesson?.id, lessonGate.challenge?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // A learner whose verdict has not arrived is PENDING, not free: on
  // 2026-09-01 one walked out through the activity strip 3.5s into an 11.1s
  // read, so `gated === false` alone is not permission to open the menu. Who
  // counts as waiting is the HOOK's rule, not re-derived here. Under curfew
  // the menu is already shut, so there is no separate pending caption; an
  // owed lesson still appears the moment the verdict lands.
  const pending = !curfew && lessonGate.pending;
  // The daily video cap. Enforcement lives in Videos.jsx (all three routes, so
  // a deep link cannot walk around it); this is the EXPLANATION. A tile left
  // live that bounced a child straight back here would read as a broken kiosk
  // — the same failure the school lock had while it declined to say whose day
  // it was reading.
  const videosCapped = !curfew && lessonGate.videosLocked === true;

  const open = (id) => {
    if (curfew || pending) return; // belt-and-braces: the tiles are already disabled
    logger.info('piano.mode-enter', { mode: id, pianoId });
    navigate(`${basePath}/${id}`);
  };

  const openPassage = (userId, scoreId, passageId, { mode } = {}) => {
    // Tapping a child's card IS picking that child: their progress,
    // their credit (owner-requested 2026-07-28).
    if (userId) setCurrentUser(userId);
    if (curfew || pending) return; // the door the 2026-09-01 escape used
    // A passage opens Learn on it; an all-Gold piece opens Polish (ready, not started).
    const query = passageId ? `?learnPassage=${encodeURIComponent(passageId)}` : mode ? `?mode=${encodeURIComponent(mode)}` : '';
    // Encoded per path segment: an id with # or ? would otherwise cut the route short.
    navigate(`${basePath}/sheetmusic/${scoreViewPath(scoreId)}${query}`);
  };
  const desk = (
    <PianoHomeDesk
      disabled={curfew || pending}
      courseAccess={config.courseAccess}
      onOpenPassage={openPassage}
      onOpenCourse={(userId, courseId, lessonId) => {
        if (userId) setCurrentUser(userId);
        if (curfew || pending) return;
        // Straight into the lesson the card shows; the course page when that cannot resolve.
        if (lessonId && openPianoCourseLesson({ courseId, lessonId, basePath, navigate })) return;
        navigate(`${basePath}/videos/${String(courseId).replace(/^plex:/, '')}`);
      }}
    />
  );
  const lessonCard = (
    <TodaysLessonGate
      lesson={lessonGate.lesson}
      unit={lessonGate.unit}
      course={lessonGate.course}
      challenge={lessonGate.challenge}
      learnerId={currentUser}
      onCompleted={lessonGate.refresh}
      basePath={basePath}
      navigate={navigate}
    />
  );
  // Sheet music is the exception to an owed video lesson (owner, 2026-11-19):
  // the strip's piece card and one Sheet Music tile stay open beside the
  // lesson. A PianoChallenge keeps its whole screen; its ask session is the work.
  const sheetMusic = PIANO_MODES.find((m) => m.id === 'sheetmusic');

  return (
    <main className={`piano-home${curfew ? ' is-curfew' : ''}`}>
      <div className="piano-home__body">
        {lessonOnly ? lessonCard : gated ? (
          <>
            {desk}
            <div className="piano-home__owed">
              {lessonCard}
              {/* The child's latest piece goes straight in; the tile browses every score. */}
              <div className="piano-home__side">
                <LatestPieceCard userId={currentUser} onOpen={(scoreId, passageId) => openPassage(currentUser, scoreId, passageId)} />
                <PianoTile icon={sheetMusic.icon} label={sheetMusic.label} blurb={sheetMusic.blurb} onClick={() => open(sheetMusic.id)} />
              </div>
            </div>
          </>
        ) : (
          <>
          {desk}
          <ul className="piano-menu__tiles" style={{ '--tile-cols': cols }}>
            {PIANO_MODES.map((m) => {
              const gamesOffTile = (m.id === 'games' && gamesOff) || (m.id === 'videos' && coursesOff);
              // The early pass: a school-locked tile stays live while today's
              // pass cap is unused, affordable or not, so the child reaches
              // the lock (its progress line and Print button) and, with the
              // coins, the offer. An active pass already reads as unlocked
              // (`via: 'pass'`). A used cap or an unreadable ledger leaves
              // the tile shut, as before.
              const lockReachable = m.id === 'games' && !gamesOff && !gameAccess.unlocked && canEnterLock(gameAccess);
              const passOffer = lockReachable && canBuyPass(gameAccess);
              const schoolLocked = m.id === 'games' && !gamesOff && !gameAccess.unlocked && !lockReachable;
              const karaokeLocked = m.id === 'singalong' && !karaokeAccess.unlocked;
              const videosLocked = m.id === 'videos' && videosCapped;
              const disabled = m.disabled || gamesOffTile || schoolLocked || karaokeLocked || videosLocked || curfew || pending;
              // The count is the whole message. "Videos are locked" invites an
              // argument; "2 of 2 lessons today" is a fact the child can check
              // against the discs on the wall panel, which is the same number.
              const blurb = karaokeLocked
                ? 'Everyone must finish schoolwork first'
                : gamesOffTile
                ? 'Not part of your piano'
                : videosLocked
                ? `${lessonGate.videos?.completedToday ?? '?'} of ${lessonGate.videos?.cap ?? '?'} lessons today`
                : m.id === 'games' && gameAccess.via === 'pass'
                ? 'One game today'
                : m.id !== 'games' || gameAccess.unlocked
                ? m.blurb
                : passOffer
                ? 'Finish school, or buy one game'
                : gameAccess.status === 'error'
                  ? 'School status unavailable'
                  : gameAccess.state === 'indeterminate'
                    ? 'School plan needs a grown-up'
                    : gameAccess.status === 'locked'
                      ? 'Choose your profile to unlock'
                      : gameAccess.status === 'loading'
                    ? 'Checking schoolwork…'
                    : 'Finish school to unlock';

              return (
                <li key={m.id}>
                  <PianoTile
                    icon={m.icon}
                    label={m.label}
                    blurb={blurb}
                    disabled={disabled}
                    onClick={disabled ? undefined : () => open(m.id)}
                  />
                </li>
              );
            })}
          </ul>
          </>
        )}
        {curfew && (
          <p className="piano-home__curfew" role="status">
            {gated
              ? 'Screen time is over for tonight, except today\'s lesson.'
              : 'Screen time is over for tonight — but the piano is still on. Just play.'}
          </p>
        )}
        {pending && (
          <p className="piano-home__pending" role="status">{PENDING_CAPTION}</p>
        )}
      </div>
      {/* Live keyboard at the foot of the home screen: lights up to the played
          notes (and is touch-playable). No waterfall, no staff — just feedback. */}
      <div className="piano-home__keyboard">
        <LiveKeyboard
          startNote={kb.startNote}
          endNote={kb.endNote}
          onNoteOn={pressNote}
          onNoteOff={releaseNote}
        />
      </div>
    </main>
  );
}

export default PianoMenu;
