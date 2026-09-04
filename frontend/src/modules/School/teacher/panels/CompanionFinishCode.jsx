/**
 * The grown-up's escape hatch when a read-along will not play.
 *
 * A child whose companion media is broken holds a worksheet with a gate row
 * they cannot fill in, and no score saves it. This reads them the letters.
 *
 * WHAT IT DELIBERATELY DOES NOT DO is mark the companion satisfied. The record
 * keeps saying nobody listened, because a report that cannot tell a child who
 * LISTENED from one who was TOLD is worth less than one that can. So the panel
 * says that out loud beside the letters rather than hiding it: the grown-up is
 * unblocking a sheet, not certifying a lesson.
 *
 * NOTHING IS FETCHED UNTIL ASKED. There is no code on screen — and none in this
 * component's memory — until a teacher deliberately requests it and confirms
 * with the PIN, and "Hide it" puts it away again. This surface lives on a
 * household screen where the child it is a secret from can walk past.
 */
import { useState } from 'react';
import { useTeacherWrite } from '../useTeacherWrite.js';
import { teacherWorkspaceApi } from '../teacherWorkspaceApi.js';

/**
 * What each unavailable answer means to the grown-up reading it. Every one is a
 * different next move, which is why they are not one "no code" sentence.
 */
const UNAVAILABLE = {
  'no-companion': 'This lesson has no read-along, so nothing is holding the sheet back.',
  'companion-optional': 'This lesson’s read-along is optional — there is no gate row on the sheet.',
  'not-issued': 'There is no code for this lesson yet. One is made when the worksheet prints.',
  'code-unusable': 'The code saved for this lesson can’t be read. The sheet needs replacing — tell whoever looks after the server.',
};

const FALLBACK = 'There is no code to read out for this lesson.';

export function CompanionFinishCode({ sessionId, embedded = false }) {
  const [revealed, setRevealed] = useState(null);
  const { run, busy, errors } = useTeacherWrite({ panel: 'companion-finish-code' });
  const key = `finish-code:${sessionId}`;

  const reveal = () => run(key, ({ actorId, pin, stepUpToken }) => (
    teacherWorkspaceApi.revealCompanionFinishCode(sessionId, { revealedBy: actorId, pin }, stepUpToken)
  ), {
    // A fresh confirmation, scoped to this one session. An unlocked console
    // left open is not consent to hand over a child's gate.
    stepUp: { action: 'companion.finish-code.reveal', resource: sessionId },
    onSuccess: setRevealed,
  });

  const Tag = embedded ? 'div' : 'section';
  return (
    <Tag className={embedded ? 'teacher-companion-code' : 'teacher-panel teacher-companion-code'}>
      <h3 className="teacher-panel__title">Read-along code</h3>
      <p>
        If the read-along won’t play, read these letters to the child so they can fill in the
        gate row. It does not count as listening — the record will still say the read-along
        wasn’t finished.
      </p>
      {!revealed && (
        <div className="teacher-action-row">
          <button type="button" className="teacher-btn" disabled={busy === key} onClick={reveal}>
            Show the code…
          </button>
        </div>
      )}
      {revealed?.available && (
        <div className="teacher-companion-code__reveal">
          <p className="teacher-companion-code__letters">{revealed.finishCode}</p>
          <p className={revealed.earned ? 'teacher-muted' : 'teacher-companion-code__unearned'}>
            {revealed.earned
              ? 'The read-along was finished, so this code was already earned.'
              : 'Nobody has listened to this yet. Reading it out does not change that, and the record will show a grown-up gave it.'}
          </p>
          <div className="teacher-action-row">
            <button type="button" onClick={() => setRevealed(null)}>Hide it</button>
          </div>
        </div>
      )}
      {revealed && !revealed.available && (
        <>
          <p className="teacher-muted">{UNAVAILABLE[revealed.reason] ?? FALLBACK}</p>
          <div className="teacher-action-row">
            <button type="button" onClick={() => setRevealed(null)}>Close</button>
          </div>
        </>
      )}
      {errors[key] && <p className="teacher-panel__error">{errors[key]}</p>}
    </Tag>
  );
}

export default CompanionFinishCode;
