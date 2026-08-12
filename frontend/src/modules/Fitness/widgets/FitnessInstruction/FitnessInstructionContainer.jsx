import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import WorkoutRunner from './WorkoutRunner.jsx';
import ExerciseBrowser from './ExerciseBrowser.jsx';
import './FitnessInstructionContainer.scss';

/**
 * Exercise Library lifecycle container.
 *
 * Three states, in the order the user walks them:
 *   browse — filter the exercise corpus and pick exercises
 *   build  — assemble the picked exercises into a workout
 *   run    — the guided set-by-set player (WorkoutRunner)
 *
 * Browse and run are live; build is still a placeholder. Nothing HERE fetches —
 * ExerciseBrowser owns the corpus requests, and the runner's step list and
 * slug->display lookup are read off whatever the builder handed to `startRun`,
 * so they stay empty until the build screen exists.
 */

// The only legal moves out of each state. Anything else is a caller bug, so it
// is rejected (and logged) rather than silently teleporting the user.
const ALLOWED_TRANSITIONS = {
  browse: ['build'],
  build: ['run', 'browse'],
  run: ['browse']
};

const INITIAL_STATE = 'browse';

/**
 * Placeholder tap target. onPointerDown (not onClick) — see the note at the top
 * of FitnessApp.jsx: this app runs on a large touchscreen TV and onClick's
 * pointerup + capture delay is perceptible. Keyboard access (Enter/Space) is
 * kept for focusable elements.
 */
function PlaceholderAction({ testId, label, onActivate }) {
  const onKeyDown = useCallback((e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      onActivate();
    }
  }, [onActivate]);

  return (
    <div
      className="fitness-instruction__action"
      data-testid={testId}
      role="button"
      tabIndex={0}
      onPointerDown={() => onActivate()}
      onKeyDown={onKeyDown}
    >
      {label}
    </div>
  );
}

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
        <section className="fitness-instruction__state" data-testid="fitness-instruction-build">
          <h2 className="fitness-instruction__placeholder-title">Build — placeholder</h2>
          <p className="fitness-instruction__placeholder-note">
            The workout builder is not built yet. Selected exercises: {selectedExercises.length}.
          </p>
          <PlaceholderAction
            testId="fitness-instruction-to-run"
            label="Run this workout (placeholder)"
            onActivate={startRun}
          />
          <PlaceholderAction
            testId="fitness-instruction-build-back"
            label="Back to browse (placeholder)"
            onActivate={cancelBuild}
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
