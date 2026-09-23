/**
 * CardLadderWordsPanel — a grown-up's word-by-word controls for one word-
 * ladder deck (task-5-brief.md; `docs/reference/school/card-ladder.md`
 * "Grown-up word controls"). One panel per enrollment: `WordsView` renders
 * one of these per card-ladder deck the learner is enrolled in.
 *
 * Reads `GET /card-ladder/admin/words` — every word the learner can meet in
 * this package, its ladder state, and its judged typed (3.3) answers from the
 * last 14 study days, newest first. Every write here re-reads the table
 * afterward rather than guessing what the write changed, the same contract
 * `ReadingShelfPanel` uses.
 *
 * Below the table, a **Tuning** section (`GET /card-ladder/admin/tuning`):
 * the tuning agent's current values vs defaults, its last status and notes,
 * and its history with Undo per applied change (card-ladder.md "Tuning").
 *
 * `cardLadderAdminApi`, not `teacherWorkspaceApi` or `schoolApi`: the admin
 * routes are mounted at `/api/v1/school/card-ladder/admin`, a sibling base
 * neither existing client owns.
 */
import { useEffect, useState } from 'react';
import { usePanelFetch } from '../usePanelFetch.js';
import { useTeacherWrite } from '../useTeacherWrite.js';
import { useTeacherProfileOptional } from '../TeacherProfileContext.jsx';
import { teacherLog } from '../teacherLog.js';
import PanelFrame from './PanelFrame.jsx';
import { cardLadderAdminApi } from '../cardLadderAdminApi.js';
import { isCardLadderPolicy } from '../../Programs/Flashcards/CardLadder/cardLadderMode.js';

const PANEL = 'card-ladder-words';

/** `markMastered`'s stage argument: `GAPS[min(n,5)]` bounds it at 5. */
const STAGES = [0, 1, 2, 3, 4, 5];

const STATE_LABEL = {
  new: 'New', introduced: 'Introduced', learning: 'Learning', recognised: 'Recognised', mastered: 'Mastered', tricky: 'Tricky',
};

/**
 * The chip shows the word's sign-off `level` (ruling 2026-09-23): Mastered
 * only once a typed recheck signed it off; verified before that is
 * Recognised; notYet / familiar / claimed read Learning. A server that sends
 * no `level` falls back to the raw state.
 */
function StateChip({ level, state }) {
  const value = level ?? state ?? 'new';
  return <span className={`teacher-card-ladder__chip teacher-card-ladder__chip--${value}`}>{STATE_LABEL[value] ?? value}</span>;
}

/**
 * One judged typed answer. Score and reason stay hidden until a grown-up
 * expands the row — the table would otherwise read as a wall of grading
 * detail nobody asked to see yet — and Re-grade lives inside that fold so the
 * scannable row never carries a destructive control under a browsing thumb.
 */
function TypedAnswer({ term, answer, onRegrade, busy, error }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="teacher-card-ladder__typed">
      <button
        type="button"
        className="teacher-card-ladder__typed-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        title={`${answer.score != null ? `score ${answer.score}` : 'unscored'} · ${answer.reason ?? ''}`}
      >
        {answer.day} · “{answer.typed}”{answer.regraded ? ' (re-graded)' : ''}
      </button>
      {open && (
        <div className="teacher-card-ladder__typed-detail">
          <p>
            Score {answer.score ?? '—'} · judged by {answer.judge ?? 'unknown'}
            {answer.reason ? ` — ${answer.reason}` : ''}
          </p>
          <div className="teacher-action-row">
            <button type="button" aria-label={`Pass ${term} answer ${answer.typed}`} disabled={busy} onClick={() => onRegrade(answer, true)}>Pass</button>
            <button type="button" aria-label={`Fail ${term} answer ${answer.typed}`} disabled={busy} onClick={() => onRegrade(answer, false)}>Fail</button>
          </div>
          {error && <p className="teacher-panel__error">{error}</p>}
        </div>
      )}
    </li>
  );
}

function WordRow({ word, learnerId, deckId, run, busy, errors }) {
  const [stagePick, setStagePick] = useState(String(word.stage ?? 0));
  // Every write re-reads the table, and a refetch can change this word's
  // stage out from under a picker nobody has touched yet (a Reset from a
  // moment ago, another teacher's edit, mark-mastered elsewhere). The picker
  // must follow the server, not freeze at whatever it was seeded with on the
  // first render.
  useEffect(() => { setStagePick(String(word.stage ?? 0)); }, [word.stage]);
  const resetKey = `reset:${word.wordId}`;
  const masteredKey = `mastered:${word.wordId}`;
  const excludeKey = `exclude:${word.wordId}`;
  const regradeKey = (answer) => `regrade:${word.wordId}:${answer.day}:${answer.itemId}`;

  const reset = () => run(resetKey, ({ actorId }) => cardLadderAdminApi.reset({
    learnerId, deckId, wordId: word.wordId, actorId, pin: null,
  }));

  const markMastered = () => run(masteredKey, ({ actorId }) => cardLadderAdminApi.markMastered({
    learnerId, deckId, wordId: word.wordId, stage: Number(stagePick), actorId, pin: null,
  }));

  const toggleExclude = () => run(excludeKey, ({ actorId }) => cardLadderAdminApi.exclude({
    learnerId, deckId, wordId: word.wordId, excluded: !word.excluded, actorId, pin: null,
  }));

  // The judgement cache is shared by every learner studying this package
  // (card-ladder.md "Grown-up word controls") — a wrong Fail on an answer the
  // engine already scored `exact` mis-grades that same typed string for
  // every OTHER child too, not just this one. Only Fail asks, and only for
  // `exact`: Pass never disagrees with an exact match, and a non-exact judge
  // (`model`/`distance`/`fallback`/`no-hangul`/`guard`) was already uncertain.
  const regrade = (answer, pass) => {
    if (!pass && answer.judge === 'exact' && !window.confirm(
      `“${answer.typed}” was judged an exact match, and re-grading a shared word affects every learner studying this package. Mark it wrong anyway?`,
    )) return;
    run(regradeKey(answer), ({ actorId }) => cardLadderAdminApi.regrade({
      learnerId, deckId, day: answer.day, itemId: answer.itemId, pass, actorId, pin: null,
    }));
  };

  const rowError = errors[resetKey] || errors[masteredKey] || errors[excludeKey];
  const term = word.term;

  return (
    <tr className="teacher-card-ladder__row" data-excluded={word.excluded ? 'true' : 'false'}>
      <td>{word.term}</td>
      <td>{word.gloss}</td>
      <td><StateChip level={word.level} state={word.state} /></td>
      <td>{word.stage ?? '—'}</td>
      <td>{word.dueDay ?? '—'}</td>
      <td>{word.missStreak ?? 0}</td>
      <td>{word.tricky ? 'Yes' : '—'}</td>
      <td>{word.excluded ? 'Yes' : '—'}</td>
      <td>
        {word.recentTyped?.length ? (
          <ul className="teacher-card-ladder__typed-list">
            {word.recentTyped.map((answer) => (
              <TypedAnswer
                key={`${answer.day}:${answer.itemId}`}
                term={term}
                answer={answer}
                busy={busy === regradeKey(answer)}
                error={errors[regradeKey(answer)]}
                onRegrade={regrade}
              />
            ))}
          </ul>
        ) : <span className="teacher-muted">No typed answers yet.</span>}
      </td>
      <td className="teacher-card-ladder__actions">
        <div className="teacher-action-row">
          <button type="button" aria-label={`Reset ${term}`} disabled={busy === resetKey} onClick={reset}>Reset</button>
          <label className="teacher-card-ladder__stage-pick">
            Mastered stage
            <select
              aria-label={`Mastered stage for ${term}`}
              value={stagePick}
              onChange={(event) => setStagePick(event.target.value)}
            >
              {STAGES.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
            </select>
          </label>
          <button type="button" aria-label={`Mark ${term} mastered`} disabled={busy === masteredKey} onClick={markMastered}>Mark mastered</button>
          <button type="button" aria-label={`${word.excluded ? 'Include' : 'Exclude'} ${term}`} disabled={busy === excludeKey} onClick={toggleExclude}>
            {word.excluded ? 'Include' : 'Exclude'}
          </button>
        </div>
        {rowError && <p className="teacher-panel__error">{rowError}</p>}
      </td>
    </tr>
  );
}

/**
 * Every deck the learner has ever drawn new words from. Only a deck the
 * server names in `droppableDecks` gets the button — the server refuses to
 * drop the CURRENT deck (this panel's own `deckId`) or one still actively
 * enrolled, so offering the button everywhere just to have it refused would
 * be a control that lies about what it can do. The rest are named with why
 * they can't be dropped, not silently hidden.
 */
function DeckPool({ decksSeen, droppableDecks, learnerId, deckId, run, busy, errors }) {
  if (!decksSeen?.length) return null;
  const droppable = new Set(droppableDecks ?? []);
  const key = (id) => `drop-deck:${id}`;
  const drop = (dropDeckId) => run(key(dropDeckId), ({ actorId }) => cardLadderAdminApi.dropDeck({
    learnerId, deckId, dropDeckId, actorId, pin: null,
  }));
  return (
    <div className="teacher-card-ladder__pool">
      <h3 className="teacher-card-ladder__pool-title">New-word pool</h3>
      <ul className="teacher-card-ladder__pool-list">
        {decksSeen.map((id) => (
          <li key={id}>
            <span>{id}</span>
            {droppable.has(id) ? (
              <button type="button" aria-label={`Drop ${id} from pool`} disabled={busy === key(id)} onClick={() => drop(id)}>Drop from pool</button>
            ) : (
              <span className="teacher-muted">{id === deckId ? 'current' : 'assigned'}</span>
            )}
            {errors[key(id)] && <p className="teacher-panel__error">{errors[key(id)]}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

const fmt = (value) => (value === null || value === undefined ? '—' : String(value));

/**
 * One applied change in the tuning history. Undo is offered only when the
 * server says the change is still the setting's latest and still in force
 * (`undoable`); an undone change says so instead.
 */
function AppliedChange({ change, day, onUndo, busy, error, nameOf }) {
  const what = `${change.setting} ${fmt(change.from)} → ${fmt(change.to)}`;
  return (
    <li className="teacher-card-ladder__tuning-change">
      <span>{what}</span>
      {change.reason ? <span className="teacher-muted"> — {change.reason}</span> : null}
      {change.undone ? (
        <span className="teacher-muted"> · undone {change.undone.day} by {nameOf(change.undone.actorId)}</span>
      ) : change.undoable ? (
        <button type="button" aria-label={`Undo ${what} on ${day}`} disabled={busy} onClick={() => onUndo(change)}>Undo</button>
      ) : null}
      {error && <p className="teacher-panel__error">{error}</p>}
    </li>
  );
}

/**
 * The tuning agent for this learner × package (card-ladder.md "Tuning"):
 * each tunable's current value against its default and bounds, the last
 * run's status and notes, and the history with Undo per applied change.
 * Its own fetch: a tuning read that fails must not take the word table with it.
 */
function TuningSection({ learnerId, deckId, actorId, rawRun, busy, errors, nameOf }) {
  const record = usePanelFetch(() => cardLadderAdminApi.tuning(learnerId, deckId, actorId), {
    deps: [learnerId, deckId, actorId],
    panel: `${PANEL}:tuning`,
    notFoundAs: 'unavailable',
  });
  const data = record.data;
  const key = (day, setting) => `undo:${day}:${setting}`;
  const undo = (day, change) => rawRun(key(day, change.setting), ({ actorId: actor }) => cardLadderAdminApi.undoTuning({
    learnerId, deckId, setting: change.setting, actorId: actor, pin: null,
  }), {
    onSuccess: () => { teacherLog.write('saved', { panel: PANEL, learnerId, deckId, key: key(day, change.setting) }); record.retry(); },
  });
  let body;
  if (record.state === 'loading') body = <p className="teacher-muted">Loading tuning…</p>;
  else if (!data) body = <p className="teacher-muted">Tuning is not available for this deck.</p>;
  else {
    const last = data.last;
    body = (
      <>
        <p className="teacher-card-ladder__tuning-last">
          {last ? (
            <>Last tuned {last.day}: <strong>{last.status ?? (last.error ? 'failed' : '—')}</strong></>
          ) : 'Not tuned yet.'}
        </p>
        {last?.notes?.length ? (
          <ul className="teacher-card-ladder__tuning-notes">{last.notes.map((note) => <li key={note}>{note}</li>)}</ul>
        ) : null}
        <table className="teacher-card-ladder__table teacher-card-ladder__tuning-table">
          <thead><tr><th>Setting</th><th>Current</th><th>Default</th><th>Bounds</th></tr></thead>
          <tbody>
            {(data.settings ?? []).map((row) => (
              <tr key={row.setting} data-tuned={row.tuned ? 'true' : 'false'}>
                <td>{row.setting}</td>
                <td>{fmt(row.current)}</td>
                <td>{fmt(row.default)}</td>
                <td>{fmt(row.min)}–{fmt(row.max)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.history?.length ? (
          <ol className="teacher-card-ladder__tuning-history">
            {data.history.map((entry, index) => (
              <li key={`${entry.day}:${index}`}>
                <span>{entry.day} · {entry.undo ? `grown-up undo by ${nameOf(entry.actorId)}` : (entry.status ?? (entry.error ? 'failed' : '—'))}</span>
                {entry.error ? <span className="teacher-muted"> — {entry.error}</span> : null}
                {entry.applied?.length ? (
                  <ul>
                    {entry.applied.map((change) => (
                      <AppliedChange
                        key={change.setting}
                        change={change}
                        day={entry.day}
                        busy={busy === key(entry.day, change.setting)}
                        error={errors[key(entry.day, change.setting)]}
                        onUndo={(c) => undo(entry.day, c)}
                        nameOf={nameOf}
                      />
                    ))}
                  </ul>
                ) : null}
                {entry.dropped?.length ? (
                  <p className="teacher-muted">
                    Held back: {entry.dropped.map((row) => `${row.setting} → ${fmt(row.to)} (${row.brake})`).join(', ')}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        ) : <p className="teacher-muted">No tuning history yet.</p>}
      </>
    );
  }
  return (
    <section className="teacher-card-ladder__tuning" aria-labelledby={`tuning-${deckId}`}>
      <h3 id={`tuning-${deckId}`} className="teacher-card-ladder__pool-title">Tuning</h3>
      {body}
    </section>
  );
}

/**
 * @param {object} props
 * @param {string} props.learnerId
 * @param {string} props.deckId - the enrollment's `deckId`; the read walks
 *   every deck the learner has ever seen, not only this one, but every write
 *   is scoped through this deck so the teacher gate can attribute it.
 * @param {string} [props.title] - the enrollment's own `title`, falling back
 *   to the deck id when the plan never named one.
 */
export default function CardLadderWordsPanel({ learnerId, deckId, title = null }) {
  // The GET is teacher-gated: TeacherGate.assert checks isAdult(userId)
  // BEFORE it ever looks at the capability/pin, so an actorId-less read is
  // refused with a 403 regardless of the cookie. `useTeacherProfileOptional`
  // (not the throwing `useTeacherProfile`) because a fetch, unlike a write,
  // must not crash a screen it is mounted on outside the console.
  const profile = useTeacherProfileOptional();
  const actorId = profile?.currentTeacher?.id ?? null;
  // Who undid a change, by the roster's display name — never the raw id.
  const nameOf = (id) => (profile?.teachers ?? []).find((teacher) => teacher.id === id)?.name
    ?? (profile?.currentTeacher?.id === id ? profile?.currentTeacher?.name : null)
    ?? 'a grown-up';
  const record = usePanelFetch(() => cardLadderAdminApi.words(learnerId, deckId, actorId), {
    deps: [learnerId, deckId, actorId],
    panel: PANEL,
    notFoundAs: 'unavailable',
    isEmpty: (data) => !(data?.words ?? []).length,
  });
  const { run: rawRun, busy, errors } = useTeacherWrite({ panel: PANEL });

  // Every write re-reads the table instead of guessing what it changed
  // (ReadingShelfPanel's contract). Wrapping `run` here, rather than passing
  // `record.retry` into every caller, keeps that rule in one place.
  const run = (key, call) => rawRun(key, call, {
    onSuccess: () => { teacherLog.write('saved', { panel: PANEL, learnerId, deckId, key }); record.retry(); },
  });

  const words = record.data?.words ?? [];
  const decksSeen = record.data?.decksSeen ?? [];
  const droppableDecks = record.data?.droppableDecks ?? [];

  return (
    <PanelFrame
      title={title ?? deckId}
      state={record.state}
      retry={record.retry}
      emptyCopy="No words recorded yet for this deck."
      unavailableCopy="Card ladder is not available on this install."
    >
      <div className="teacher-card-ladder">
        <table className="teacher-card-ladder__table">
          <thead>
            <tr>
              <th>Term</th><th>Gloss</th><th>State</th><th>Stage</th><th>Due</th>
              <th>Streak</th><th>Tricky</th><th>Excluded</th><th>Typed answers</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {words.map((word) => (
              <WordRow key={word.wordId} word={word} learnerId={learnerId} deckId={deckId} run={run} busy={busy} errors={errors} />
            ))}
          </tbody>
        </table>
        <DeckPool decksSeen={decksSeen} droppableDecks={droppableDecks} learnerId={learnerId} deckId={deckId} run={run} busy={busy} errors={errors} />
        <TuningSection learnerId={learnerId} deckId={deckId} actorId={actorId} rawRun={rawRun} busy={busy} errors={errors} nameOf={nameOf} />
      </div>
    </PanelFrame>
  );
}

/**
 * The learner's card-ladder enrollments, out of `GET /lifecycle/assignments`'s
 * `programs` array (same shape `AssignmentsView`/`readingPrograms.js` read):
 * `{programId: 'flashcards', deckId, title, policy: {mode: 'card-ladder'}, schedule}`.
 * A `flashcards` entry without `policy.mode === 'card-ladder'` (or its
 * pre-rename alias `word-ladder`) is an ordinary
 * flashcard deck and does not belong on this tab.
 */
export function cardLadderEnrollments(programs) {
  return (Array.isArray(programs) ? programs : [])
    .filter((entry) => entry?.programId === 'flashcards' && isCardLadderPolicy(entry?.policy) && entry?.deckId);
}
