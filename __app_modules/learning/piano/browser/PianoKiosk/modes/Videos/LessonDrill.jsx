import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AskSession from '../../../ask/AskSession.jsx';
import RepInterstitial from '../Games/RepInterstitial.jsx';
import { projectDrill, drillStepFor, describeDrillStep, resolveGateDrill } from '../Games/gateDrill.js';
import { usePianoMidi } from '../../PianoMidiContext.jsx';
import { createHumanNoteClassifier } from '../../humanNoteClassifier.js';
import getLogger from '../../../../../../../frontend/src/lib/logging/Logger.js';
import {
  DRILL_TITLE, drillSubtitle, gentleSubtitle, DRILL_DONE, DRILL_START, DRILL_NOT_NOW, DRILL_UNAVAILABLE,
  GENTLE_CLIMB, GENTLE_ECHO,
} from './lessonCreditCopy.js';
import './LessonDrill.scss';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-lesson-drill' });
  return _logger;
}

export const DONE_MS = 2000;
/** Completeness only, played freely — the gate's tier-2 reading: a missed note is played again. */
export const DRILL_REQUIREMENT = Object.freeze({ mode: 'free', rubric: Object.freeze({ criteria: Object.freeze({ completeness: 1 }) }), passScore: null });
const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const noteName = (n) => NAMES[((n % 12) + 12) % 12];

/** One gentle round (preschool): climb N rising notes, or echo a short pattern. */
function GentleRound({ round, onPassed }) {
  const { subscribe } = usePianoMidi() || {};
  const [progress, setProgress] = useState(0);
  const passedRef = useRef(false);
  const onPassedRef = useRef(onPassed);
  onPassedRef.current = onPassed;
  // Round state lives in a ref so a re-subscribe (a new subscribe identity)
  // never forgets the notes already played.
  const st = useRef(null);
  if (!st.current) st.current = { classifier: createHumanNoteClassifier(), last: null, run: 0, recent: [] };
  useEffect(() => {
    if (typeof subscribe !== 'function') return undefined;
    const s = st.current;
    return subscribe((evt) => {
      if (passedRef.current || evt?.type !== 'note_on' || !(evt.velocity > 0)) return;
      const v = s.classifier.classify({ ...evt, time: Number.isFinite(evt.time) ? evt.time : Date.now() });
      if (!v.human) return;
      let done = false;
      const recent = s.recent;
      if (round.type === 'climb') {
        s.run = s.last != null && evt.note > s.last ? s.run + 1 : 1;
        s.last = evt.note;
        setProgress(Math.min(s.run, round.count));
        done = s.run >= round.count;
      } else {
        recent.push(evt.note);
        if (recent.length > round.notes.length) recent.shift();
        let k = 0;
        // How much of the pattern the latest notes complete (a prefix match).
        for (let len = Math.min(recent.length, round.notes.length); len > 0; len--) {
          if (recent.slice(-len).every((n, i) => n === round.notes[i])) { k = len; break; }
        }
        setProgress(k);
        done = k === round.notes.length;
      }
      if (done) { passedRef.current = true; onPassedRef.current?.(); }
    });
  }, [subscribe, round]);

  const slots = round.type === 'climb'
    ? Array.from({ length: round.count }, (_, i) => ({ label: i === 0 ? noteName(round.start ?? 60) : '↑', on: i < progress }))
    : round.notes.map((n, i) => ({ label: noteName(n), on: i < progress }));
  return (
    <div className="lesson-drill__gentle">
      <p className="lesson-drill__ask">{round.type === 'climb' ? GENTLE_CLIMB : GENTLE_ECHO}</p>
      <ol className="lesson-drill__slots">
        {slots.map((s, i) => (
          <li key={i} className={s.on ? 'lesson-drill__slot lesson-drill__slot--on' : 'lesson-drill__slot'}>{s.label}</li>
        ))}
      </ol>
    </div>
  );
}

/**
 * LessonDrill — the warm-up a lesson owes before it counts. Swapped in place of
 * the video (never over it), so only one thing listens to the piano. Scale
 * drills reuse the match gate's drill machinery (gateDrill + AskSession);
 * preschool courses get one or two gentle finger games instead. A missed rep
 * is simply played again — no failure state, no score on screen.
 */
export default function LessonDrill({ drill, onRepPassed, onComplete, onLeave, context = null, variant = 'lesson' }) {
  const checkin = variant === 'checkin';
  const spec = drill?.spec ?? null;
  const gentle = spec?.kind === 'gentle';
  const total = Math.max(1, Number(drill?.reps) || 1);
  const [phase, setPhase] = useState(checkin ? 'starting' : 'intro');
  const [served, setServed] = useState(null);
  const [passes, setPasses] = useState([]);
  const [attempt, setAttempt] = useState(0);
  const [repCard, setRepCard] = useState(null);
  const passedRef = useRef(0);
  const ctx = useMemo(() => ({ ...(context || {}), kind: gentle ? 'gentle' : 'scales', reps: total }), [context, gentle, total]);

  const finish = useCallback(() => {
    setPhase('done');
    logger().info('piano.lesson-drill.completed', { ...ctx, passed: passedRef.current });
  }, [ctx]);

  useEffect(() => {
    if (phase !== 'done') return undefined;
    const t = setTimeout(() => onComplete?.(), checkin ? 0 : DONE_MS);
    return () => clearTimeout(t);
  }, [phase, onComplete]);

  const bank = useCallback((n) => {
    passedRef.current = n;
    logger().info('piano.lesson-drill.rep-passed', { ...ctx, n });
    onRepPassed?.(n);
  }, [ctx, onRepPassed]);

  const start = useCallback(async () => {
    logger().info('piano.lesson-drill.started', ctx);
    if (gentle) { setPhase('run'); return; }
    const resolved = await resolveGateDrill({ spec, pickIndex: 0 });
    if (!resolved?.ok) {
      logger().warn('piano.lesson-drill.unavailable', { ...ctx, error: resolved?.error ?? null });
      setPhase('unavailable');
      return;
    }
    setServed(resolved);
    setPhase('run');
  }, [ctx, gentle, spec]);

  const leave = useCallback(() => {
    logger().info('piano.lesson-drill.left', { ...ctx, passed: passedRef.current });
    onLeave?.(passedRef.current);
  }, [ctx, onLeave]);

  const handleScalePassed = useCallback(() => {
    if (!served?.program) return;
    const next = [...passes, served.spec.instanceId];
    const projection = projectDrill(served.program, next);
    setPasses(next);
    bank(next.length);
    if (projection.complete || next.length >= total) { finish(); return; }
    const step = drillStepFor(projection);
    const steps = projection.steps;
    const playedIndex = Math.max(0, steps.findIndex((s) => s.id === served.stepId));
    const played = steps[playedIndex];
    setRepCard({
      score: null, setIndex: playedIndex + 1, setCount: steps.length,
      repIndex: played?.pass_count ?? 1, repCount: played?.requirement?.required_passes ?? 1,
      setClear: step.id !== served.stepId, next: describeDrillStep(step),
    });
    setServed({ ...served, spec: { kind: 'exercise', instanceId: step.requirement.exercise_id }, stepId: step.id, projection });
    setAttempt((a) => a + 1);
  }, [bank, finish, passes, served, total]);

  const rounds = gentle ? (spec.rounds || []).slice(0, total) : [];
  const handleGentlePassed = useCallback(() => {
    const n = passedRef.current + 1;
    bank(n);
    if (n >= rounds.length) finish();
    else setAttempt((a) => a + 1);
  }, [bank, finish, rounds.length]);

  // A check-in starts at once: the heading above it already said why.
  useEffect(() => {
    if (checkin && phase === 'starting') start();
  }, [checkin, phase, start]);

  if (phase === 'starting') return <section className="lesson-drill lesson-drill--run" data-testid="lesson-drill" />;
  if (checkin && phase === 'unavailable') {
    // A check-in whose scale cannot load must never trap the child: it closes.
    onComplete?.();
    return null;
  }
  if (phase === 'intro' || phase === 'unavailable') {
    return (
      <section className="lesson-drill lesson-drill--intro" data-testid="lesson-drill">
        <h2 className="lesson-drill__title">{DRILL_TITLE}</h2>
        <p className="lesson-drill__subtitle">
          {phase === 'unavailable' ? DRILL_UNAVAILABLE : (gentle ? gentleSubtitle(rounds.length || total) : drillSubtitle(total))}
        </p>
        <div className="lesson-drill__actions">
          {phase === 'intro' && <button type="button" className="lesson-drill__primary" onClick={start}>{DRILL_START}</button>}
          <button type="button" className="lesson-drill__secondary" onClick={leave}>{DRILL_NOT_NOW}</button>
        </div>
      </section>
    );
  }

  if (phase === 'done') {
    if (checkin) return null;
    return (
      <section className="lesson-drill lesson-drill--done" data-testid="lesson-drill" role="status">
        <h2 className="lesson-drill__title">{DRILL_DONE}</h2>
      </section>
    );
  }

  const current = !gentle && served?.projection ? drillStepFor(served.projection) : null;
  const named = current ? describeDrillStep(current) : null;
  const progress = gentle ? null : [named?.key, named?.hand].filter(Boolean).join(', ');
  return (
    <section className="lesson-drill lesson-drill--run" data-testid="lesson-drill">
      {!gentle && (
        <p className="lesson-drill__progress">
          {progress ? `${progress} — ` : ''}{`scale ${Math.min(passes.length + 1, total)} of ${total}`}
        </p>
      )}
      <div className="lesson-drill__stage">
        {gentle ? (
          <GentleRound key={attempt} round={rounds[passedRef.current] ?? rounds[0]} onPassed={handleGentlePassed} />
        ) : (
          <AskSession
            key={`${served?.spec?.instanceId}:${attempt}`}
            intent="challenge"
            materialSpec={served?.spec}
            requirementOverride={DRILL_REQUIREMENT}
            drillProjection={served?.projection ?? null}
            bare
            onPassed={handleScalePassed}
            onFailed={() => setAttempt((a) => a + 1)}
            onExit={leave}
            onUnavailable={(reason) => { logger().warn('piano.lesson-drill.unavailable', { ...ctx, reason }); setPhase('unavailable'); }}
          />
        )}
        {repCard && <RepInterstitial {...repCard} onDone={() => setRepCard(null)} />}
      </div>
      {!checkin && <button type="button" className="lesson-drill__leave" onClick={leave}>{DRILL_NOT_NOW}</button>}
    </section>
  );
}
