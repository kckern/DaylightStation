import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import { useOptionalFitnessContext } from '@/context/FitnessContext.jsx';
import WorkoutRunner from './WorkoutRunner.jsx';
import ExerciseBrowser from './ExerciseBrowser.jsx';
import WorkoutBuilder from './WorkoutBuilder.jsx';
import { logStrengthRun } from './strengthRunLog.js';
import './FitnessInstructionContainer.scss';

/**
 * Exercise Library lifecycle container.
 *
 * Three states, in the order the user walks them:
 *   browse — filter the exercise corpus and pick exercises
 *   build  — assemble the picked exercises into a workout
 *   run    — the guided set-by-set player (WorkoutRunner)
 *
 * All three are live. Nothing HERE fetches for DISPLAY: ExerciseBrowser owns the
 * corpus requests, WorkoutBuilder owns the save AND the run expansion, and the
 * runner's step list and slug->display lookup are read off whatever the builder
 * handed to `startRun`. The builder gets the flat ordered step list from the server
 * (`POST /workouts/run`), because expansion is the domain's job and the frontend
 * must not hold a second copy of it. See the docblocks in WorkoutBuilder.jsx and
 * WorkoutRunner.jsx.
 *
 * THE ONE THING THIS CONTAINER DOES OWN: FILING THE FINISHED RUN
 * --------------------------------------------------------------
 * A finished run has to reach `strength.runs[]` on the fitness session record, or
 * session detail, the recap sweep, the longitudinal widget and Strava
 * reconciliation never learn the workout happened. That is this layer's job and
 * not the runner's, for the same reason the expansion is not the runner's: the
 * runner is a player over a step list and should stay ignorant of sessions,
 * shelves and HTTP. It reports what was finished; this decides where that goes.
 *
 * The session it goes to is resolved by ADOPT-ELSE-OPEN, and the mechanics and the
 * reasoning both live in strengthRunLog.js. The part that matters here is what the
 * screen says: the completion panel carries the recording state, and a failure is
 * shown as a failure with a retry, never swallowed into "Nice work".
 */

// The only legal moves out of each state. Anything else is a caller bug, so it
// is rejected (and logged) rather than silently teleporting the user.
const ALLOWED_TRANSITIONS = {
  browse: ['build'],
  build: ['run', 'browse'],
  run: ['browse']
};

const INITIAL_STATE = 'browse';

export default function FitnessInstructionContainer({ onMount, logRun = logStrengthRun } = {}) {
  const logger = useMemo(() => getLogger().child({ component: 'fitness-instruction' }), []);

  // The live fitness session, when there is a fitness app around us. Optional on
  // purpose — see useOptionalFitnessContext; the module is also rendered outside a
  // provider in tests, and "no session" is a case this screen handles rather than
  // crashes on. CycleGameContainer reads the context the same way (its RESULTS go
  // to its own /cycle-races store, which is why it is not the precedent for the
  // recording below — a strength run belongs on the session record).
  const fitnessCtx = useOptionalFitnessContext();
  const fitnessSession = fitnessCtx?.fitnessSessionInstance ?? null;
  const fitnessSessionRef = useRef(fitnessSession);
  fitnessSessionRef.current = fitnessSession;

  const [view, setView] = useState(INITIAL_STATE); // browse | build | run
  // Exercises the user has picked out of the corpus while browsing. Shape is
  // owned by the browse task; nothing populates it yet.
  const [selectedExercises, setSelectedExercises] = useState([]);
  // The workout draft being assembled in `build`, and handed to `run`. null =
  // nothing under construction.
  const [workout, setWorkout] = useState(null);
  // Whether the finished run reached the session record: idle | pending | ok |
  // failed, plus the plain-language reason a failure is shown with.
  const [runLog, setRunLog] = useState({ status: 'idle', message: null });

  const workoutRef = useRef(workout);
  workoutRef.current = workout;
  // Guards a double-file: the retry target and an in-flight first attempt can both
  // be live for a moment.
  const loggingRef = useRef(false);

  // Mirrors `view` so a transition can read the CURRENT state without putting
  // the log call inside a setState updater (React may invoke updaters twice).
  const viewRef = useRef(view);

  // FitnessModuleContainer passes an inline `onMount` arrow, so its identity
  // changes on every parent render — keeping it in the effect's deps would
  // re-fire "mounted" (and the loader callback) on each of those. Ref it and
  // run the effect exactly once; `logger` is useMemo-stable.
  const onMountRef = useRef(onMount);
  onMountRef.current = onMount;

  useEffect(() => {
    logger.info('mounted', { view: INITIAL_STATE });
    onMountRef.current?.();
  }, [logger]);

  const transition = useCallback((to) => {
    const from = viewRef.current;
    if (from === to) return false;
    if (!(ALLOWED_TRANSITIONS[from] || []).includes(to)) {
      logger.warn('state-transition-rejected', { from, to });
      return false;
    }
    viewRef.current = to;
    logger.debug('state-transition', { from, to });
    setView(to);
    return true;
  }, [logger]);

  // browse → build. The browse screen hands over the exercises it collected.
  const startBuild = useCallback((exercises = []) => {
    if (!transition('build')) return;
    const picked = Array.isArray(exercises) ? exercises : [];
    setSelectedExercises(picked);
    setWorkout({ exercises: picked });
  }, [transition]);

  // build → run. The builder hands over the workout it assembled.
  const startRun = useCallback((builtWorkout = null) => {
    if (!transition('run')) return;
    if (builtWorkout) setWorkout(builtWorkout);
  }, [transition]);

  // run → browse. A finished OR abandoned run drops the draft and returns to
  // the corpus.
  const endRun = useCallback(() => {
    if (!transition('browse')) return;
    setWorkout(null);
    setSelectedExercises([]);
    setRunLog({ status: 'idle', message: null });
  }, [transition]);

  /**
   * File the finished run against a fitness session.
   *
   * Called by the runner's `onComplete` with the WORK steps it actually finished,
   * and again by the retry target with the same list. Never throws: `logRun`
   * returns a verdict, and every branch of that verdict ends up on screen.
   */
  const recordRun = useCallback(async (completedSteps = []) => {
    if (loggingRef.current) return;
    loggingRef.current = true;
    setRunLog({ status: 'pending', message: null });

    const plan = workoutRef.current;
    logger.info('run-log-start', {
      workoutId: plan?.id ?? null,
      completedSteps: Array.isArray(completedSteps) ? completedSteps.length : 0,
      hasSession: Boolean(fitnessSessionRef.current?.sessionId)
    });

    let result;
    try {
      result = await logRun({
        workout: plan,
        completedSteps,
        session: fitnessSessionRef.current
      });
    } catch (err) {
      // logStrengthRun is written not to throw; if it ever does, the person still
      // has to be told the sets are not on the record.
      result = { ok: false, reason: 'unexpected', message: err?.message || 'The sets you did could not be recorded.' };
    } finally {
      loggingRef.current = false;
    }

    if (result?.ok) {
      logger.info('run-logged', {
        sessionId: result.sessionId,
        workoutId: result.workoutId,
        sets: result.sets,
        openedSession: result.openedSession,
        savedWorkout: result.savedWorkout
      });
      setRunLog({ status: 'ok', message: null });
      return;
    }

    logger.error('run-log-failed', {
      reason: result?.reason ?? null,
      sessionId: result?.sessionId ?? null,
      workoutId: result?.workoutId ?? null,
      error: result?.message ?? null
    });
    setRunLog({ status: 'failed', message: result?.message ?? null });
  }, [logger, logRun]);

  // The runner consumes a FLAT, already-ordered step list — `expandWorkout`
  // (backend/src/2_domains/fitness/workout/workout.mjs) owns that ordering and
  // its docblock is explicit that the player must not re-derive it, so nothing
  // is flattened here. The builder fetches it from the run endpoint before it
  // hands the plan over; a workout that still carries no `steps` (an empty plan)
  // runs as the empty-plan screen.
  const runSteps = useMemo(
    () => (Array.isArray(workout?.steps) ? workout.steps : []),
    [workout]
  );

  // slug -> { name, image } for the runner. The corpus records the builder
  // passed through already carry those fields, so index them rather than
  // fetching; an unindexed slug renders from the slug itself.
  const exerciseLookup = useMemo(() => {
    const source = Array.isArray(workout?.exercises)
      ? workout.exercises
      : selectedExercises;
    const map = {};
    (Array.isArray(source) ? source : []).forEach((entry) => {
      const slug = typeof entry?.slug === 'string' ? entry.slug.trim() : '';
      if (slug) map[slug] = { name: entry.name ?? null, image: entry.image ?? null };
    });
    return map;
  }, [workout, selectedExercises]);

  // build → browse. Backing out of the builder discards the draft.
  const cancelBuild = useCallback(() => {
    if (!transition('browse')) return;
    setWorkout(null);
    setSelectedExercises([]);
  }, [transition]);

  return (
    <div className="fitness-instruction" data-testid="fitness-instruction" data-state={view}>
      {view === 'browse' && (
        <section
          className="fitness-instruction__state fitness-instruction__state--browse"
          data-testid="fitness-instruction-browse"
        >
          {/* The browser owns the `fitness-instruction-to-build` target — the
              move to build carries the tray it collected, so the button has to
              live where the tray does. */}
          <ExerciseBrowser onStartBuild={startBuild} />
        </section>
      )}

      {view === 'build' && (
        <section
          className="fitness-instruction__state fitness-instruction__state--build"
          data-testid="fitness-instruction-build"
        >
          {/* The builder owns both `fitness-instruction-to-run` and
              `fitness-instruction-build-back` — the move to run carries the plan
              it assembled, so those targets have to live where the plan does. */}
          <WorkoutBuilder
            exercises={selectedExercises}
            onStartRun={startRun}
            onCancel={cancelBuild}
          />
        </section>
      )}

      {view === 'run' && (
        <section
          className="fitness-instruction__state fitness-instruction__state--run"
          data-testid="fitness-instruction-run"
        >
          {/* The runner owns the `fitness-instruction-run-exit` target — a run
              is ended from inside the player (finished or abandoned), not from
              chrome around it. */}
          <WorkoutRunner
            steps={runSteps}
            exercises={exerciseLookup}
            title={workout?.title ?? null}
            onExit={endRun}
            onComplete={recordRun}
            logStatus={runLog.status}
            logMessage={runLog.message}
            onRetryLog={recordRun}
          />
        </section>
      )}
    </div>
  );
}
