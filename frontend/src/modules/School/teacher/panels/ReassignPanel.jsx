/**
 * ReassignPanel — attribution repair (wave 5, spec D1): pick a day, see the
 * mis-credited learner's work, move it to the right sibling.
 *
 * TWO repairs live here, because the household has two kinds of evidence and
 * one of them used to have no repair at all:
 *
 *  - **Recorded answers** — the machine has attempt events under the wrong
 *    name. The move is the storage design's own mechanism: evidence and
 *    statistics travel together and provenance rides the moved events.
 *  - **Lessons with no recorded answers** — a program-served lesson, paper a
 *    grown-up marked by hand, a launch outcome. There are no attempts to move;
 *    the whole work session is re-credited by an appended `reassigned` event,
 *    and it needs a reason because nothing else records why.
 *
 * They are listed separately and never conflated: a piece of work appears in
 * exactly one list, under the repair that can actually reach it. The day picker
 * offers days from BOTH — a day whose only work was program-served has no
 * attempts, and offering it nowhere would send a grown-up back to typing dates
 * blind, which is the defect the picker exists to have fixed.
 */
import { useState } from 'react';
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import { useTeacherWrite } from '../useTeacherWrite.js';
import { curriculumTitles } from '../curriculumTitles.js';

const RECENT_DAYS = 14;

export default function ReassignPanel({ learnerId, learnerName, kids = [] }) {
  const [day, setDay] = useState('');
  // Recent days WITH recorded work (advocacy B18) — no more typing dates blind.
  const recentDays = usePanelFetch(() => schoolApi.attemptDays(learnerId), {
    deps: [learnerId],
    panel: 'attempt-days',
    isEmpty: (d) => !(d?.days ?? []).length,
  });
  // The learner's work sessions — the console's existing read, not a new
  // endpoint. It supplies both the extra days above and the movable lessons
  // below, and it is refetched after a move so the lists cannot go stale.
  const work = usePanelFetch(() => schoolApi.learnerSessions(learnerId), {
    deps: [learnerId],
    panel: 'reassign-sessions',
    notFoundAs: 'unavailable',
    isEmpty: (d) => !(d?.sessions ?? []).length,
  });
  // Lesson names for the session rows. An opaque unitId is a join key, not a
  // label — the same rule `/attempts-summary` follows for bank ids.
  const catalog = usePanelFetch(() => schoolApi.curriculumUnits(), {
    panel: 'reassign-catalog',
    notFoundAs: 'unavailable',
    isEmpty: (d) => !(d?.units ?? []).length,
  });
  const [loaded, setLoaded] = useState(null); // { day, assessments } — null = nothing loaded
  const [loadError, setLoadError] = useState(null);
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const { run, busy, errors } = useTeacherWrite({ panel: 'reassign' });
  const siblings = kids.filter((k) => k.id !== learnerId);
  const titles = curriculumTitles(catalog.data?.units ?? []);

  const allSessions = work.data?.sessions ?? [];
  // The household's 4am-boundary study day, NOT the row's `day` — that one is a
  // UTC slice of the opening timestamp, so west of UTC an evening lesson files
  // itself under tomorrow and vanishes from the button for the day it was
  // actually done. Same `studyDay ?? day` rule the session timeline follows.
  const dayOf = (s) => s.studyDay ?? s.day ?? null;
  const days = [...new Set([
    ...(recentDays.data?.days ?? []),
    ...allSessions.map(dayOf).filter(Boolean),
  ])].sort().reverse().slice(0, RECENT_DAYS);

  const assessments = loaded?.assessments ?? null;
  // A session the attempts summary already covers is movable by the evidence
  // repair above; listing it again below would offer two different repairs for
  // one piece of work.
  const withAttempts = new Set((assessments ?? []).map((a) => a.assessmentId));
  const sessions = loaded
    ? allSessions.filter((s) => dayOf(s) === loaded.day && !withAttempts.has(s.sessionId))
    : [];
  // Names come from the catalog; when that read failed there are no names, and
  // labelling every row identically while leaving its Re-credit button live is
  // how a grown-up moves the wrong lesson. Fall back to the id — a join key is
  // a poor label but it is the only thing left that distinguishes the rows —
  // and say why, so the ids read as a degradation rather than as the design.
  const catalogNamed = catalog.state === 'ok';
  const labelFor = (s) => (catalogNamed
    ? titles.lesson(s.unitId)
    : s.unitId ?? 'Lesson with no unit recorded');

  const load = async (forDay = day) => {
    setLoadError(null);
    const summary = await schoolApi.attemptsSummary(learnerId, forDay);
    if (!summary.ok) { setLoadError('Couldn’t load that day’s work.'); setLoaded(null); return; }
    setLoaded({ day: forDay, assessments: summary.data?.assessments ?? [] });
  };

  const move = (a) => run(a.assessmentId, ({ actorId, pin }) => schoolApi.reassign({
    fromLearnerId: learnerId, toLearnerId: target, day: loaded.day, assessmentId: a.assessmentId,
    reassignedBy: actorId, pin,
  }), { onSuccess: () => load(loaded.day) });

  // `fromLearnerId` is deliberately not sent: the server reads it off the
  // session's own log, so a panel left open across another move cannot assert
  // who the work currently belongs to.
  const moveSession = (s) => run(`session:${s.sessionId}`, ({ actorId, pin }) => schoolApi.reassignSession({
    sessionId: s.sessionId, toLearnerId: target, reason, reassignedBy: actorId, pin,
  }), { onSuccess: () => { setReason(''); work.retry(); load(loaded.day); } });

  return (
    <section className="teacher-panel">
      <h2 className="teacher-panel__title">Attribution repair</h2>
      <p className="teacher-panel__empty">
        Work recorded against {learnerName ?? learnerId} that belongs to a sibling — pick the day it happened.
      </p>
      {days.length > 0 && (
        <div className="teacher-reassign__days">
          {days.map((d) => (
            <button key={d} type="button" data-active={d === day ? '' : undefined} onClick={() => setDay(d)}>{d}</button>
          ))}
        </div>
      )}
      <div className="teacher-reassign__controls">
        <input aria-label="Day" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        <button type="button" disabled={!day} onClick={() => load()}>Load that day</button>
        <select aria-label="Move to" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Move to…</option>
          {siblings.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
      </div>
      {loadError && <p className="teacher-panel__error">{loadError}</p>}
      {assessments && assessments.length === 0 && sessions.length === 0 && (
        <p className="teacher-panel__empty">No recorded work that day.</p>
      )}
      {assessments && assessments.length > 0 && (
        <ul className="teacher-quizreq">
          {assessments.map((a) => (
            <li key={a.assessmentId} className="teacher-quizreq__row">
              <span>{a.title ?? a.bankTitle ?? 'Recorded work with no published title'}</span>
              <span className="teacher-quizreq__meta">{a.count} answer{a.count === 1 ? '' : 's'}</span>
              <button type="button" disabled={!target || busy === a.assessmentId} onClick={() => move(a)}>Reassign</button>
              {errors[a.assessmentId] && <p className="teacher-panel__error">{errors[a.assessmentId]}</p>}
            </li>
          ))}
        </ul>
      )}
      {loaded && work.state === 'error' && (
        <p className="teacher-panel__error">Couldn’t load that day’s lessons — only recorded answers are listed.</p>
      )}
      {sessions.length > 0 && (
        <div className="teacher-reassign__sessions">
          <p className="teacher-panel__empty">
            Lessons with no recorded answers. Moving one re-credits the whole lesson to the sibling.
          </p>
          {!catalogNamed && (
            <p className="teacher-panel__error">Lesson names couldn’t be loaded — these are their ids.</p>
          )}
          <textarea
            aria-label="Reason"
            placeholder="Whose work is it, and how do you know? (required)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <ul className="teacher-quizreq">
            {sessions.map((s) => (
              <li key={s.sessionId} className="teacher-quizreq__row">
                <span>{labelFor(s)}</span>
                <span className="teacher-quizreq__meta">{s.state ?? 'not started'}</span>
                <button
                  type="button"
                  disabled={!target || !reason.trim() || busy === `session:${s.sessionId}`}
                  onClick={() => moveSession(s)}
                >
                  Re-credit
                </button>
                {errors[`session:${s.sessionId}`] && <p className="teacher-panel__error">{errors[`session:${s.sessionId}`]}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
