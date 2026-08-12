import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import WorkoutRunner from './WorkoutRunner.jsx';
import ExerciseBrowser from './ExerciseBrowser.jsx';
import WorkoutBuilder from './WorkoutBuilder.jsx';
import './FitnessInstructionContainer.scss';

/**
 * Exercise Library lifecycle container.
 *
 * Three states, in the order the user walks them:
 *   browse — filter the exercise corpus and pick exercises
 *   build  — assemble the picked exercises into a workout
 *   run    — the guided set-by-set player (WorkoutRunner)
 *
 * All three are live. Nothing HERE fetches: ExerciseBrowser owns the corpus
 * requests, WorkoutBuilder owns the save, and the runner's step list and
 * slug->display lookup are read off whatever the builder handed to `startRun`.
 * The builder hands over the AUTHORED plan (groups) plus display records, not a
 * flat step list — expansion is the domain's job and no endpoint serves it yet,
 * so a run still renders the empty-plan screen. See the docblocks in
 * WorkoutBuilder.jsx and WorkoutRunner.jsx.
 */

// The only legal moves out of each state. Anything else is a caller bug, so it
// is rejected (and logged) rather than silently teleporting the user.
const ALLOWED_TRANSITIONS = {
  browse: ['build'],
  build: ['run', 'browse'],
  run: ['browse']
};

const INITIAL_STATE = 'browse';

export default function FitnessInstructionContainer({ onMount } = {}) {
  const logger = useMemo(() => getLogger().child({ component: 'fitness-instruction' }), []);

  const [view, setView] = useState(INITIAL_STATE); // browse | build | run
  // Exercises the user has picked out of the corpus while browsing. Shape is
  // owned by the browse task; nothing populates it yet.
  const [selectedExercises, setSelectedExercises] = useState([]);
  // The workout draft being assembled in `build`, and handed to `run`. null =
  // nothing under construction.
  const [workout, setWorkout] = useState(null);

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
  }, [transition]);

  // The runner consumes a FLAT, already-ordered step list — `expandWorkout`
  // (backend/src/2_domains/fitness/workout/workout.mjs) owns that ordering and
  // its docblock is explicit that the player must not re-derive it, so nothing
  // is flattened here. Until the run API lands, a workout that carries no
  // `steps` runs as an empty plan.
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
          />
        </section>
      )}
    </div>
  );
}
