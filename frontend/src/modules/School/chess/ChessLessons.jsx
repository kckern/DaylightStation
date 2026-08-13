import { useCallback, useEffect, useMemo, useState } from 'react';
import { describeGame, createGame, legalDestinations, playMove } from '@shared-gaming/chess/index.mjs';
import { chooseMove } from '@shared-gaming/chess/opponent.mjs';
import ChessBoard from '../../Chess/ChessBoard.jsx';
import { CHESS_UNITS, LESSON_KINDS, curriculumProgress, findLesson, lessonStatus } from './chessCurriculum.js';
import './ChessLessons.scss';

/**
 * Chess in School — the course shell.
 *
 * The curriculum's shape is real and navigable; the teaching inside each lesson
 * is not written yet, and the interface says so rather than pretending. A lesson
 * that is still an outline opens its position on a playable board, which is
 * useful on its own and is the surface the written steps will attach to.
 */

const OPPONENT_DELAY_MS = 600;

function UnitList({ onOpen }) {
  const progress = curriculumProgress();
  return (
    <div className="chess-lessons__units">
      <header className="chess-lessons__intro">
        <h1 className="chess-lessons__title">Chess</h1>
        <p className="chess-lessons__blurb">
          Eight units, from naming a square to beating an opponent.
        </p>
        <p className="chess-lessons__status">
          {progress.lessons} lessons planned · {progress.ready} written · {progress.outline} still outlines
        </p>
      </header>
      <ol className="chess-lessons__unit-grid">
        {CHESS_UNITS.map((unit, index) => (
          <li key={unit.id}>
            <button type="button" className="chess-lessons__unit" onClick={() => onOpen(unit.id)}>
              {/* The units are a sequence — each one assumes the one before it. */}
              <span className="chess-lessons__unit-index">{String(index + 1).padStart(2, '0')}</span>
              <span className="chess-lessons__unit-title">{unit.title}</span>
              <span className="chess-lessons__unit-summary">{unit.summary}</span>
              <span className="chess-lessons__unit-count">{unit.lessons.length} lessons</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

function LessonList({ unit, onOpen, onBack }) {
  return (
    <div className="chess-lessons__lessons">
      <button type="button" className="chess-lessons__back" onClick={onBack}>← All units</button>
      <h1 className="chess-lessons__title">{unit.title}</h1>
      <p className="chess-lessons__blurb">{unit.summary}</p>
      <ul className="chess-lessons__lesson-list">
        {unit.lessons.map((lesson) => (
          <li key={lesson.id}>
            <button type="button" className="chess-lessons__lesson" onClick={() => onOpen(lesson.id)}>
              <span className={`chess-lessons__kind chess-lessons__kind--${lesson.kind}`}>
                {LESSON_KINDS[lesson.kind]?.label ?? lesson.kind}
              </span>
              <span className="chess-lessons__lesson-title">{lesson.title}</span>
              <span className="chess-lessons__lesson-summary">{lesson.summary}</span>
              {lessonStatus(lesson) === 'outline' && (
                <span className="chess-lessons__outline-flag">Outline</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LessonBoard({ lesson, onBack }) {
  const [game, setGame] = useState(() => createGame({ fen: lesson.fen }));
  const [selected, setSelected] = useState(null);
  const status = useMemo(() => describeGame(game), [game]);
  const isPlay = lesson.kind === 'play';

  useEffect(() => {
    setGame(createGame({ fen: lesson.fen }));
    setSelected(null);
  }, [lesson.fen]);

  const destinations = selected ? (legalDestinations(game.fen, selected)[selected] || []) : [];

  const onSelect = useCallback((square) => {
    setGame((current) => {
      const legal = legalDestinations(current.fen);
      if (selected && (legal[selected] || []).includes(square)) {
        const result = playMove(current, { from: selected, to: square, promotion: 'q' });
        setSelected(null);
        return result.error ? current : result.game;
      }
      setSelected(legal[square]?.length ? square : null);
      return current;
    });
  }, [selected]);

  // In a play lesson the computer answers; elsewhere the student moves both
  // sides, which is how you demonstrate a line to yourself.
  useEffect(() => {
    if (!isPlay || status?.game_over || status?.turn === 'w') return undefined;
    const timer = setTimeout(() => {
      setGame((current) => {
        const reply = chooseMove(current.fen, { difficulty: lesson.difficulty || 'learner', seed: current.moves.length });
        if (!reply) return current;
        const result = playMove(current, { from: reply.from, to: reply.to, promotion: reply.promotion });
        return result.error ? current : result.game;
      });
    }, OPPONENT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isPlay, lesson.difficulty, status]);

  const outcome = status?.game_over
    ? (status.outcome === 'checkmate' ? `Checkmate — ${status.winner === 'w' ? 'White' : 'Black'} wins.` : `Draw — ${status.outcome.replace(/_/g, ' ')}.`)
    : `${status?.turn === 'w' ? 'White' : 'Black'} to move${status?.check ? ' — in check' : ''}`;

  return (
    <div className="chess-lessons__lesson-view">
      <div className="chess-lessons__lesson-head">
        <button type="button" className="chess-lessons__back" onClick={onBack}>← {lesson.unitTitle}</button>
        <h1 className="chess-lessons__title">{lesson.title}</h1>
        <p className="chess-lessons__blurb">{lesson.summary}</p>
        {lessonStatus(lesson) === 'outline' && (
          <p className="chess-lessons__outline-note">
            The teaching for this lesson is not written yet. The board below is live —
            move both sides and explore the position.
          </p>
        )}
        <p className="chess-lessons__outcome" role="status">{outcome}</p>
        <dl className="chess-lessons__facts">
          <div><dt>Selected</dt><dd>{selected ?? '—'}</dd></div>
          <div><dt>Moves played</dt><dd>{game.moves.length}</dd></div>
        </dl>
        <button
          type="button"
          className="chess-lessons__reset"
          onClick={() => { setGame(createGame({ fen: lesson.fen })); setSelected(null); }}
        >
          Start over
        </button>
      </div>
      <ChessBoard
        fen={game.fen}
        status={status}
        selected={selected}
        destinations={destinations}
        onSelect={onSelect}
        className="chess-lessons__board"
      />
    </div>
  );
}

export default function ChessLessons() {
  const [unitId, setUnitId] = useState(null);
  const [lessonId, setLessonId] = useState(null);

  const unit = CHESS_UNITS.find((candidate) => candidate.id === unitId) ?? null;
  const lesson = lessonId ? findLesson(lessonId) : null;

  return (
    <div className="chess-lessons">
      {lesson
        ? <LessonBoard lesson={lesson} onBack={() => setLessonId(null)} />
        : unit
          ? <LessonList unit={unit} onOpen={setLessonId} onBack={() => setUnitId(null)} />
          : <UnitList onOpen={setUnitId} />}
    </div>
  );
}
