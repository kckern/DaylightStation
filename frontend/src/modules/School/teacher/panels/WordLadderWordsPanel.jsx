/**
 * WordLadderWordsPanel — a grown-up's word-by-word controls for one word-
 * ladder deck (task-5-brief.md; `docs/reference/school/word-ladder.md`
 * "Grown-up word controls"). One panel per enrollment: `WordsView` renders
 * one of these per word-ladder deck the learner is enrolled in.
 *
 * Reads `GET /word-ladder/admin/words` — every word the learner can meet in
 * this package, its ladder state, and its judged typed (3.3) answers from the
 * last 14 study days, newest first. Every write here re-reads the table
 * afterward rather than guessing what the write changed, the same contract
 * `ReadingShelfPanel` uses.
 *
 * `wordLadderAdminApi`, not `teacherWorkspaceApi` or `schoolApi`: the admin
 * routes are mounted at `/api/v1/school/word-ladder/admin`, a sibling base
 * neither existing client owns.
 */
import { useEffect, useState } from 'react';
import { usePanelFetch } from '../usePanelFetch.js';
import { useTeacherWrite } from '../useTeacherWrite.js';
import { useTeacherProfileOptional } from '../TeacherProfileContext.jsx';
import { teacherLog } from '../teacherLog.js';
import PanelFrame from './PanelFrame.jsx';
import { wordLadderAdminApi } from '../wordLadderAdminApi.js';

const PANEL = 'word-ladder-words';

/** `markMastered`'s stage argument: `GAPS[min(n,5)]` bounds it at 5. */
const STAGES = [0, 1, 2, 3, 4, 5];

const STATE_LABEL = {
  new: 'New', introduced: 'Introduced', learning: 'Learning', mastered: 'Mastered', tricky: 'Tricky',
};

function StateChip({ state }) {
  const value = state ?? 'new';
  return <span className={`teacher-word-ladder__chip teacher-word-ladder__chip--${value}`}>{STATE_LABEL[value] ?? value}</span>;
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
    <li className="teacher-word-ladder__typed">
      <button
        type="button"
        className="teacher-word-ladder__typed-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        title={`${answer.score != null ? `score ${answer.score}` : 'unscored'} · ${answer.reason ?? ''}`}
      >
        {answer.day} · “{answer.typed}”{answer.regraded ? ' (re-graded)' : ''}
      </button>
      {open && (
        <div className="teacher-word-ladder__typed-detail">
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

  const reset = () => run(resetKey, ({ actorId }) => wordLadderAdminApi.reset({
    learnerId, deckId, wordId: word.wordId, actorId, pin: null,
  }));

  const markMastered = () => run(masteredKey, ({ actorId }) => wordLadderAdminApi.markMastered({
    learnerId, deckId, wordId: word.wordId, stage: Number(stagePick), actorId, pin: null,
  }));

  const toggleExclude = () => run(excludeKey, ({ actorId }) => wordLadderAdminApi.exclude({
    learnerId, deckId, wordId: word.wordId, excluded: !word.excluded, actorId, pin: null,
  }));

  // The judgement cache is shared by every learner studying this package
  // (word-ladder.md "Grown-up word controls") — a wrong Fail on an answer the
  // engine already scored `exact` mis-grades that same typed string for
  // every OTHER child too, not just this one. Only Fail asks, and only for
  // `exact`: Pass never disagrees with an exact match, and a non-exact judge
  // (`model`/`distance`/`fallback`/`no-hangul`/`guard`) was already uncertain.
  const regrade = (answer, pass) => {
    if (!pass && answer.judge === 'exact' && !window.confirm(
      `“${answer.typed}” was judged an exact match, and re-grading a shared word affects every learner studying this package. Mark it wrong anyway?`,
    )) return;
    run(regradeKey(answer), ({ actorId }) => wordLadderAdminApi.regrade({
      learnerId, deckId, day: answer.day, itemId: answer.itemId, pass, actorId, pin: null,
    }));
  };

  const rowError = errors[resetKey] || errors[masteredKey] || errors[excludeKey];
  const term = word.term;

  return (
    <tr className="teacher-word-ladder__row" data-excluded={word.excluded ? 'true' : 'false'}>
      <td>{word.term}</td>
      <td>{word.gloss}</td>
      <td><StateChip state={word.state} /></td>
      <td>{word.stage ?? '—'}</td>
      <td>{word.dueDay ?? '—'}</td>
      <td>{word.missStreak ?? 0}</td>
      <td>{word.tricky ? 'Yes' : '—'}</td>
      <td>{word.excluded ? 'Yes' : '—'}</td>
      <td>
        {word.recentTyped?.length ? (
          <ul className="teacher-word-ladder__typed-list">
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
      <td className="teacher-word-ladder__actions">
        <div className="teacher-action-row">
          <button type="button" aria-label={`Reset ${term}`} disabled={busy === resetKey} onClick={reset}>Reset</button>
          <label className="teacher-word-ladder__stage-pick">
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
  const drop = (dropDeckId) => run(key(dropDeckId), ({ actorId }) => wordLadderAdminApi.dropDeck({
    learnerId, deckId, dropDeckId, actorId, pin: null,
  }));
  return (
    <div className="teacher-word-ladder__pool">
      <h3 className="teacher-word-ladder__pool-title">New-word pool</h3>
      <ul className="teacher-word-ladder__pool-list">
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

/**
 * @param {object} props
 * @param {string} props.learnerId
 * @param {string} props.deckId - the enrollment's `deckId`; the read walks
 *   every deck the learner has ever seen, not only this one, but every write
 *   is scoped through this deck so the teacher gate can attribute it.
 * @param {string} [props.title] - the enrollment's own `title`, falling back
 *   to the deck id when the plan never named one.
 */
export default function WordLadderWordsPanel({ learnerId, deckId, title = null }) {
  // The GET is teacher-gated: TeacherGate.assert checks isAdult(userId)
  // BEFORE it ever looks at the capability/pin, so an actorId-less read is
  // refused with a 403 regardless of the cookie. `useTeacherProfileOptional`
  // (not the throwing `useTeacherProfile`) because a fetch, unlike a write,
  // must not crash a screen it is mounted on outside the console.
  const profile = useTeacherProfileOptional();
  const actorId = profile?.currentTeacher?.id ?? null;
  const record = usePanelFetch(() => wordLadderAdminApi.words(learnerId, deckId, actorId), {
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
      unavailableCopy="Word ladder is not available on this install."
    >
      <div className="teacher-word-ladder">
        <table className="teacher-word-ladder__table">
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
      </div>
    </PanelFrame>
  );
}

/**
 * The learner's word-ladder enrollments, out of `GET /lifecycle/assignments`'s
 * `programs` array (same shape `AssignmentsView`/`readingPrograms.js` read):
 * `{programId: 'flashcards', deckId, title, policy: {mode: 'word-ladder'}, schedule}`.
 * A `flashcards` entry without `policy.mode === 'word-ladder'` is an ordinary
 * flashcard deck and does not belong on this tab.
 */
export function wordLadderEnrollments(programs) {
  return (Array.isArray(programs) ? programs : [])
    .filter((entry) => entry?.programId === 'flashcards' && entry?.policy?.mode === 'word-ladder' && entry?.deckId);
}
