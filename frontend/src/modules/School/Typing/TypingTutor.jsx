/**
 * TypingTutor — the barebones Drill (typing-tutor spec, Mode 1 only). Shows a
 * target line; the child types it with live per-character correctness and a
 * running WPM + accuracy; finishing a line advances through the lesson set and
 * ends on a short summary. No arcade, no weak-key targeting, no persistence —
 * those are named deferrals (see the spec and the README's typing note).
 *
 * The stats/status logic is the pure `typingEngine`; this component owns only
 * the keystroke capture, the timer, and the rendering. Keyboard input is a
 * window keydown listener (the Portal is touch-only for most apps, but typing
 * needs the Bluetooth keyboard by nature; there is nothing to focus).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LESSONS, computeCharStatuses, computeStats, applyKey } from './typingEngine.js';
import { schoolLog } from '../schoolLog.js';

export default function TypingTutor() {
  const [lessonIndex, setLessonIndex] = useState(0);
  const [typed, setTyped] = useState('');
  const [startedAt, setStartedAt] = useState(null);
  const [now, setNow] = useState(0);
  const [finished, setFinished] = useState(false); // whole set complete

  const lesson = LESSONS[lessonIndex];
  const target = lesson?.text ?? '';

  const { statuses, caret } = useMemo(() => computeCharStatuses(target, typed), [target, typed]);
  const elapsed = startedAt ? now - startedAt : 0;
  const stats = useMemo(() => computeStats(target, typed, elapsed), [target, typed, elapsed]);

  // Tick a clock only while a line is in progress, for a live WPM read.
  useEffect(() => {
    if (!startedAt || stats.done) return undefined;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [startedAt, stats.done]);

  const resetLine = useCallback(() => {
    setTyped('');
    setStartedAt(null);
    setNow(0);
  }, []);

  const advance = useCallback(() => {
    if (lessonIndex + 1 < LESSONS.length) {
      setLessonIndex((i) => i + 1);
      resetLine();
    } else {
      setFinished(true);
    }
  }, [lessonIndex, resetLine]);

  const restart = useCallback(() => {
    setLessonIndex(0);
    setFinished(false);
    resetLine();
  }, [resetLine]);

  // Keystroke capture. Prevent default on printable keys and Backspace so the
  // line doesn't scroll / the browser doesn't navigate back on Backspace.
  useEffect(() => {
    if (finished) return undefined;
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const isPrintable = e.key.length === 1;
      if (!isPrintable && e.key !== 'Backspace') return;
      e.preventDefault();
      if (!startedAt && isPrintable) { const t = Date.now(); setStartedAt(t); setNow(t); }
      setTyped((prev) => applyKey(prev, e.key, target));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finished, startedAt, target]);

  // On line completion, log the result once (fires when `done` flips true).
  useEffect(() => {
    if (stats.done && startedAt) {
      schoolLog.typing?.('line-done', { lessonId: lesson.id, wpm: stats.wpm, accuracy: stats.accuracy });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats.done]);

  if (finished) {
    return (
      <div className="school-typing school-typing--done">
        <h2 className="school-typing__done-title">Nice work!</h2>
        <p className="school-typing__done-sub">You finished every line.</p>
        <button type="button" className="school-typing__button" onClick={restart}>Start over</button>
      </div>
    );
  }

  return (
    <div className="school-typing">
      <div className="school-typing__bar">
        <span className="school-typing__lesson">Lesson {lessonIndex + 1} of {LESSONS.length} · {lesson.label}</span>
        <span className="school-typing__stats">
          <span><strong>{stats.wpm}</strong> wpm</span>
          <span><strong>{stats.accuracy}</strong>% accuracy</span>
        </span>
      </div>

      <p className="school-typing__target" aria-label="Text to type">
        {target.split('').map((ch, i) => (
          <span
            key={i}
            className={[
              'school-typing__char',
              `is-${statuses[i]}`,
              i === caret ? 'is-caret' : '',
              ch === ' ' ? 'is-space' : '',
            ].filter(Boolean).join(' ')}
          >
            {ch}
          </span>
        ))}
      </p>

      {stats.done ? (
        <div className="school-typing__linedone">
          <span>{stats.wpm} wpm · {stats.accuracy}% — {statuses.filter((s) => s === 'incorrect').length} slip{statuses.filter((s) => s === 'incorrect').length === 1 ? '' : 's'}</span>
          <div className="school-typing__linedone-actions">
            <button type="button" className="school-typing__button" onClick={resetLine}>Retry</button>
            <button type="button" className="school-typing__button school-typing__button--primary" onClick={advance}>
              {lessonIndex + 1 < LESSONS.length ? 'Next line' : 'Finish'}
            </button>
          </div>
        </div>
      ) : (
        <p className="school-typing__hint">
          {startedAt ? 'Keep going — type the line above.' : 'Start typing to begin. Errors are marked; you can fix them or press on.'}
        </p>
      )}
    </div>
  );
}
