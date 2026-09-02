import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import getLogger from '../../../lib/logging/Logger.js';
import { usePianoKioskConfig } from './PianoConfig.jsx';
import { usePianoMidi } from './PianoMidiContext.jsx';
import { usePianoUser } from './PianoUserContext.jsx';
import PianoTile from './PianoTile.jsx';
import PianoMenuActivity from './PianoMenuActivity.jsx';
import LiveKeyboard from './LiveKeyboard.jsx';
import { balancedColumns } from './tileGridLayout.js';
import usePianoCurfew from './usePianoCurfew.js';
import useSchoolGameAccess from './useSchoolGameAccess.js';
import usePianoLessonGate, { PENDING_CAPTION } from './usePianoLessonGate.js';
import TodaysLessonGate from './TodaysLessonGate.jsx';
import { PIANO_MODES } from './pianoModes.js';

/**
 * PianoMenu — the touch-first home screen for a piano. Tiles route to each mode.
 *
 * Under curfew (config.curfew, default 19:00–06:00) the whole menu goes dark:
 * every tile and every activity-strip card greys out and stops responding. The
 * one thing still working is the piano — sitting down and playing auto-enters
 * Studio (useAutoStudioEntry in PianoApp), which is deliberately independent of
 * this menu, so evening free play is unaffected.
 *
 * While the active player still owes today's assigned School piano lesson, the
 * tiles and the activity strip are REPLACED by that one lesson
 * (TodaysLessonGate) — not greyed out, which is curfew's look and would read as
 * "everything is closed" rather than "here is the one thing". It clears itself
 * when School says the day is discharged. Curfew outranks it.
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
  const kb = config?.keyboard || { startNote: 21, endNote: 108 };
  const logger = useMemo(() => getLogger().child({ component: 'piano-menu' }), []);
  const cols = balancedColumns(PIANO_MODES.length); // 10 → 5
  const curfew = usePianoCurfew(config?.curfew);
  // Curfew wins outright: after bedtime there is nothing to offer, so the
  // closed-for-the-night view stands rather than a launchable lesson card.
  const lessonGate = usePianoLessonGate(currentUser);
  const gated = !curfew && lessonGate.gated;
  // A learner whose verdict has not arrived is PENDING, not free: on
  // 2026-09-01 one walked out through the activity strip 3.5s into an 11.1s
  // read, so `gated === false` alone is not permission to open the menu. Who
  // counts as waiting is the HOOK's rule, not re-derived here — this screen
  // only adds that curfew outranks it, having nothing left to wait for.
  const pending = !curfew && lessonGate.pending;

  const open = (id) => {
    if (curfew || pending) return; // belt-and-braces: the tiles are already disabled
    logger.info('piano.mode-enter', { mode: id, pianoId });
    navigate(`${basePath}/${id}`);
  };

  return (
    <main className={`piano-home${curfew ? ' is-curfew' : ''}`}>
      <div className="piano-home__body">
        {gated ? (
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
        ) : (
          <>
          <PianoMenuActivity
            disabled={curfew || pending}
            onOpenCourse={(courseId, userId) => {
              logger.info('piano.menu-activity.open-course', { courseId, userId });
              // Tapping a player's card IS picking that player: their progress,
              // their credit (owner-requested 2026-07-28 — supersedes the
              // original no-switch design).
              if (userId) setCurrentUser(userId);
              if (curfew || pending) return; // the door the 2026-09-01 escape used
              navigate(`${basePath}/videos/${String(courseId).replace(/^plex:/, '')}`);
            }}
          />
          <ul className="piano-menu__tiles" style={{ '--tile-cols': cols }}>
            {PIANO_MODES.map((m) => {
              const schoolLocked = m.id === 'games' && !gameAccess.unlocked;
              const disabled = m.disabled || schoolLocked || curfew || pending;
              const blurb = m.id !== 'games' || gameAccess.unlocked
                ? m.blurb
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
            Screen time is over for tonight — but the piano is still on. Just play.
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
