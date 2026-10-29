/**
 * CardLadderDaysPanel — one card-ladder deck, day by day, for a grown-up:
 * every day the learner opened (when, how long, how the graded answers went,
 * which words they missed), and inside a day every answer in the order they
 * gave it — what was asked, what they did, the verdict and the right answer —
 * plus the spoken takes kept that day.
 *
 * Reads `GET /card-ladder/admin/days` and, when a day is opened,
 * `GET /card-ladder/admin/day` (card-ladder.md "Grown-up word controls").
 * Strictly reads: re-grading a typed answer stays in the word table above,
 * where the word's state lives.
 */
import { useState } from 'react';
import { usePanelFetch } from "../usePanelFetch.js";
import { useTeacherProfileOptional } from "../TeacherProfileContext.jsx";
import { teacherLog } from "../teacherLog.js";
import PanelFrame from "./PanelFrame.jsx";
import { cardLadderAdminApi } from "../cardLadderAdminApi.js";
import { humanDate } from "../teacherDates.js";
import { clockOf, describeResponse, describeStep, minutesOf, outcomeOf } from "../cardLadderDayLog.js";

const PANEL = 'card-ladder-days';
const VERDICT = { right: '✓', wrong: '✗', ungraded: '—' };

function Answer({ row }) {
  const { section, activity } = describeStep(row);
  const outcome = outcomeOf(row);
  const typed = typeof row.response?.typed === 'string';
  return (
    <li className={`teacher-ladder-day__answer is-${outcome}`}>
      <span className="teacher-ladder-day__time">{clockOf(row.at) ?? ''}</span>
      <span className="teacher-ladder-day__word">
        <strong>{row.term ?? row.wordId ?? '—'}</strong>
        {row.gloss && <small>{row.gloss}</small>}
      </span>
      <span className="teacher-ladder-day__step">{section}{activity ? ` · ${activity}` : ''}</span>
      <span className="teacher-ladder-day__given">{describeResponse(row.response)}</span>
      <span className="teacher-ladder-day__verdict" aria-label={outcome === 'ungraded' ? 'Not graded' : outcome === 'right' ? 'Right' : 'Wrong'}>
        {VERDICT[outcome]}
      </span>
      {outcome === 'wrong' && row.answer && <small className="teacher-ladder-day__expected">Correct answer: {row.answer}</small>}
      {typed && row.judge && (
        <small className="teacher-ladder-day__judge">
          Judged {row.judge}{row.score != null ? `, ${row.score}/10` : ''}{row.reason ? ` — ${row.reason}` : ''}
          {row.regraded ? ` · re-graded ${row.regraded.pass ? 'pass' : 'fail'}` : ''}
        </small>
      )}
    </li>
  );
}

function Takes({ learnerId, deckId, day, actorId, recordings }) {
  const byWord = new Map();
  for (const take of recordings) {
    if (!byWord.has(take.wordId)) byWord.set(take.wordId, { ...take, takes: [] });
    byWord.get(take.wordId).takes.push(take.take);
  }
  return (
    <div className="teacher-ladder-day__takes">
      <h4>Spoken takes <small>(never graded)</small></h4>
      <ul>
        {[...byWord.values()].map((word) => (
          <li key={word.wordId}>
            <span><strong>{word.term ?? word.wordId}</strong>{word.gloss && <small> {word.gloss}</small>}</span>
            {word.takes.map((take) => (
              <label key={take}>
                <small>Take {take}</small>
                <audio controls preload="none" src={cardLadderAdminApi.recordingUrl(learnerId, deckId, day, word.wordId, take, actorId)} />
              </label>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DayDetail({ learnerId, deckId, day, actorId }) {
  const record = usePanelFetch(() => cardLadderAdminApi.day(learnerId, deckId, day, actorId), {
    deps: [learnerId, deckId, day, actorId], panel: `${PANEL}-day`,
    isEmpty: (d) => !(d?.answers ?? []).length && !(d?.recordings ?? []).length,
  });
  if (record.state === 'loading') return <div className="teacher-panel__skeleton" aria-label="Loading the day" />;
  if (record.state === 'error') {
    return <p className="teacher-panel__error">Couldn’t load this day. <button type="button" className="teacher-panel__retry" onClick={record.retry}>Retry</button></p>;
  }
  if (record.state !== 'ok') return <p className="teacher-panel__empty">Nothing was answered this day.</p>;
  const { answers = [], recordings = [] } = record.data;
  return (
    <div className="teacher-ladder-day__detail">
      <ol className="teacher-ladder-day__answers">{answers.map((row) => <Answer key={row.itemId} row={row} />)}</ol>
      {recordings.length > 0 && <Takes learnerId={learnerId} deckId={deckId} day={day} actorId={actorId} recordings={recordings} />}
    </div>
  );
}

function DayRow({ summary, open, onToggle, children }) {
  const minutes = minutesOf(summary.activeMs);
  return (
    <li className={`teacher-ladder-day${open ? ' is-open' : ''}`}>
      <button type="button" className="teacher-ladder-day__head" aria-expanded={open} onClick={onToggle}>
        <span className="teacher-ladder-day__date">{humanDate(summary.day) ?? summary.day}</span>
        <span className="teacher-ladder-day__facts">
          {summary.graded > 0 ? `${summary.correct} / ${summary.graded} right` : 'Nothing graded'}
          {minutes ? ` · ${minutes}` : ''}
          {summary.doneAt ? ' · goal met' : ''}
        </span>
        {summary.missedWords?.length > 0 && <span className="teacher-ladder-day__missed">Missed {summary.missedWords.length}</span>}
        <span className="teacher-ladder-day__chevron" aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {open && children}
    </li>
  );
}

/**
 * @param {object} props
 * @param {string} props.learnerId
 * @param {string} props.deckId - the enrollment's deck; the days are its package's
 * @param {string} [props.title] - the deck's name, for the panel heading
 */
export default function CardLadderDaysPanel({ learnerId, deckId, title = null }) {
  const profile = useTeacherProfileOptional();
  const actorId = profile?.currentTeacher?.id ?? null;
  const record = usePanelFetch(() => cardLadderAdminApi.days(learnerId, deckId, actorId), {
    deps: [learnerId, deckId, actorId], panel: PANEL, notFoundAs: 'unavailable',
    isEmpty: (d) => !(d?.days ?? []).length,
  });
  const [openDay, setOpenDay] = useState(null);
  const toggle = (day) => {
    const next = openDay === day ? null : day;
    setOpenDay(next);
    if (next) teacherLog.read('opened', { panel: PANEL, learnerId, deckId, day });
  };
  return (
    <PanelFrame title={`${title ?? 'Card ladder'} — day by day`} state={record.state} retry={record.retry}
      emptyCopy="No days opened yet for this deck."
      unavailableCopy="Card ladder is not available on this install.">
      <ol className="teacher-ladder-days">
        {(record.data?.days ?? []).map((summary) => (
          <DayRow key={summary.day} summary={summary} open={openDay === summary.day} onToggle={() => toggle(summary.day)}>
            <DayDetail learnerId={learnerId} deckId={deckId} day={summary.day} actorId={actorId} />
          </DayRow>
        ))}
      </ol>
    </PanelFrame>
  );
}
