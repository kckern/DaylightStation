import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import getLogger from '@/lib/logging/Logger.js';
import { installCueAudioUnlock } from '@/modules/Fitness/player/hooks/audioCuePlayer.js';
import { FitnessContext } from '@/context/FitnessContext.jsx';
import RestTimer from './RestTimer.jsx';
import { resolveExercise, targetLabel } from './workoutRunnerDisplay.js';
import './WorkoutRunner.scss';

/**
 * Run — the guided set-by-set player.
 *
 * WHERE THE STEPS COME FROM (and why they are a prop)
 * ---------------------------------------------------
 * Ordering is `expandWorkout`'s job, in `backend/src/2_domains/fitness/workout/
 * workout.mjs`, and its own docblock is explicit that the player must not
 * re-derive it. This component honours that by consuming a FLAT, ALREADY
 * ORDERED `steps` array and never looking at groups, rounds or sets structure.
 *
 * It takes that array as a prop rather than importing the domain module: no
 * frontend file in this repo imports from `backend/src` (the only references
 * are prose in comments), there is no build alias that would resolve it, and
 * the alternative — a second copy of the expansion under `frontend/` — is
 * exactly the duplicated-ordering bug the domain module was written to make
 * impossible. The domain module also states the intended production shape:
 * "the Run use case is expected to join each step against the corpus
 * (resolving `slug` to a name and a GIF url) before it reaches the client".
 * So the server expands and joins; this renders. The unit tests DO import
 * `expandWorkout` directly (test code runs under Node, where the path resolves)
 * and feed its real output in, so the rendered sequence is pinned to the domain
 * rather than to a hand-written fixture that could drift from it.
 *
 * DISPLAY DATA
 * ------------
 * `exercises` is a `slug -> { name, image }` lookup. The browse API that will
 * serve it does not exist yet and is being built in parallel, so nothing here
 * fetches. A slug missing from the lookup still renders: the name falls back to
 * the humanised slug and the demo panel shows a placeholder instead of a broken
 * image. A workout referencing an exercise the corpus dropped must not blank the
 * screen of someone standing under a loaded bar.
 *
 * MANUAL ADVANCE, EVEN FOR TIMED WORK
 * -----------------------------------
 * Only rest auto-advances. A work step with `seconds` shows its duration as the
 * target and still waits for Done. Auto-advancing work would move the screen on
 * while someone is mid-plank and looking away; rest is safe to automate because
 * overshooting rest costs nothing but a tap. (This is a deliberate call — the
 * timed-work countdown is a separate feature, not a silent default.)
 *
 * INTERACTION
 * -----------
 * onPointerDown, not onClick — see the note at the top of FitnessApp.jsx: this
 * runs on a large touchscreen TV where onClick's pointerup + capture delay is
 * perceptible. Enter/Space are kept on the focusable targets.
 */

const GROUP_LABELS = { superset: 'Superset', circuit: 'Circuit', sets: 'Straight sets' };

/**
 * A TV-sized tap target. onPointerDown fires the action; Enter/Space keep it
 * reachable from a keyboard.
 */
function TapTarget({ testId, label, sub = null, variant = 'primary', onActivate }) {
  const onKeyDown = useCallback((e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      onActivate();
    }
  }, [onActivate]);

  return (
    <div
      className={`workout-runner__tap workout-runner__tap--${variant}`}
      data-testid={testId}
      role="button"
      tabIndex={0}
      onPointerDown={() => onActivate()}
      onKeyDown={onKeyDown}
    >
      <span className="workout-runner__tap-label">{label}</span>
      {sub && <span className="workout-runner__tap-sub">{sub}</span>}
    </div>
  );
}

TapTarget.propTypes = {
  testId: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  sub: PropTypes.string,
  variant: PropTypes.string,
  onActivate: PropTypes.func.isRequired
};

export default function WorkoutRunner({
  steps = [],
  exercises = {},
  title = null,
  onExit = null,
  onComplete = null,
  logStatus = 'idle',
  logMessage = null,
  onRetryLog = null
}) {
  const logger = useMemo(() => getLogger().child({ component: 'workout-runner' }), []);

  // Rest-timer cue paths come from the fitness config, never from a constant in
  // the source (`rest_timer.{tick_sound,go_sound}`). Read through the raw
  // context rather than `useFitness()` so a mount without a provider degrades
  // to silent cues instead of throwing. The config is sometimes wrapped in a
  // `.fitness` key, matching how every other consumer reads it.
  const fitnessCfg = useContext(FitnessContext)?.fitnessConfiguration;
  const restCues = useMemo(() => {
    const root = fitnessCfg?.fitness || fitnessCfg || {};
    const cues = root.rest_timer || {};
    const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    return { tickSound: str(cues.tick_sound), goSound: str(cues.go_sound) };
  }, [fitnessCfg]);

  const plan = useMemo(() => (Array.isArray(steps) ? steps : []), [steps]);
  const [cursor, setCursor] = useState(0);
  const [finished, setFinished] = useState(false);

  // Mirrors `cursor` for the advance guard below. Kept out of the setState
  // updater because React may invoke updaters twice.
  const cursorRef = useRef(0);
  const finishedRef = useRef(false);

  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const onRetryLogRef = useRef(onRetryLog);
  onRetryLogRef.current = onRetryLog;

  // The WORK steps actually finished, in the order they were finished — the report
  // the session record is built from. Accumulated as the athlete advances rather
  // than reconstructed from `cursor` at the end, because those are different
  // claims: the cursor says how far the screen got, this says what was performed.
  // A ref, not state: nothing renders from it, and a re-render per set would
  // remount the rest timer.
  const completedRef = useRef([]);

  // Arm the shared cue-audio element on the first gesture inside this screen.
  // Browse and Build both begin with taps so it is normally already unlocked
  // (installCueAudioUnlock is then a no-op) — this covers a run entered any
  // other way. Nothing is played here: an unprompted sound at run start is both
  // the thing autoplay blocks and the thing that would burn the unlock.
  useEffect(() => installCueAudioUnlock(), []);

  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    logger.info('run-start', {
      title,
      totalSteps: plan.length,
      workSteps: plan.filter((s) => s?.kind === 'work').length
    });
    // Intentionally once-only: a parent re-render with a new array identity is
    // not a new run. `title`/`plan` are read at first mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logger]);

  /**
   * Move off the step at `fromIndex`.
   *
   * The guard is what makes "Done pressed mid-rest" safe: the rest countdown
   * and the Done target can both fire for the SAME step within one tick, and
   * without the check the second one would skip a step the athlete never saw.
   * Whichever lands first advances; the loser is a no-op rather than a queued
   * jump.
   */
  /**
   * Close the run out: show the completion panel and report what was performed.
   *
   * Reached two ways — clearing the last step, and stopping early with sets
   * already done. Both are the same event as far as the record is concerned:
   * work happened and it has to be filed. The REPORT is `completedRef`, never the
   * plan, so stopping at two of six files two.
   */
  const finish = useCallback((reason) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setFinished(true);
    logger.info('run-complete', {
      title,
      reason,
      totalSteps: plan.length,
      workSteps: plan.filter((s) => s?.kind === 'work').length,
      completedSteps: completedRef.current.length
    });
    onCompleteRef.current?.(completedRef.current);
  }, [logger, plan, title]);

  const advanceFrom = useCallback((fromIndex, reason) => {
    if (finishedRef.current) return;
    if (fromIndex !== cursorRef.current) {
      logger.debug('step-advance-ignored', { fromIndex, cursor: cursorRef.current, reason });
      return;
    }
    // Moving off a work step means that set was performed. Rest carries no work,
    // and a skipped rest is still rest.
    const done = plan[fromIndex];
    if (done && done.kind !== 'rest') completedRef.current.push(done);

    const next = fromIndex + 1;
    if (next >= plan.length) {
      finish('last-step');
      return;
    }
    cursorRef.current = next;
    setCursor(next);
    logger.debug('step-advance', {
      from: fromIndex,
      to: next,
      reason,
      kind: plan[next]?.kind ?? null,
      slug: plan[next]?.slug ?? null
    });
  }, [logger, plan, title]);

  /**
   * Leave the runner.
   *
   * "End run" with sets already done does NOT leave — it finishes the run early,
   * which lands on the completion panel and files what was performed. Bailing at
   * two of six is an ordinary way to end a workout, and dropping straight back to
   * Browse would throw those two sets away with nothing on screen to say so. With
   * nothing done there is nothing to file, so it leaves immediately.
   */
  const exit = useCallback((reason) => {
    if (!finishedRef.current && completedRef.current.length > 0) {
      finish(reason);
      return;
    }
    logger.info('run-exit', { reason, cursor: cursorRef.current, totalSteps: plan.length });
    onExitRef.current?.();
  }, [finish, logger, plan.length]);

  const step = plan[cursor] ?? null;
  const nextStep = plan[cursor + 1] ?? null;

  // Rest steps name the exercise on either side of them; work steps name
  // themselves. Resolved here so both the main panel and the next-up strip read
  // from one place.
  const labelFor = useCallback((s) => {
    if (!s) return null;
    if (s.kind === 'rest') return `Rest ${s.seconds}s`;
    return resolveExercise(exercises, s.slug).name;
  }, [exercises]);

  if (plan.length === 0) {
    return (
      <div className="workout-runner workout-runner--empty" data-testid="workout-runner" data-phase="empty">
        <div className="workout-runner__headline">Nothing to run</div>
        <p className="workout-runner__note">This workout has no steps.</p>
        <TapTarget
          testId="fitness-instruction-run-exit"
          label="Back"
          variant="ghost"
          onActivate={() => exit('empty')}
        />
      </div>
    );
  }

  if (finished) {
    const doneSets = completedRef.current.length;
    const failed = logStatus === 'failed';
    return (
      <div className="workout-runner workout-runner--done" data-testid="workout-runner" data-phase="complete">
        <div className="workout-runner__complete" data-testid="workout-runner-complete">
          <div className="workout-runner__eyebrow">Workout complete</div>
          <div className="workout-runner__headline">{title || 'Nice work'}</div>
          <div className="workout-runner__note">
            {doneSets} {doneSets === 1 ? 'set' : 'sets'} done.
          </div>

          {/* Whether the work was RECORDED is a separate fact from whether it was
              done, and the screen has to say which. Someone who finished four sets
              and reads only "Nice work" will assume it counted; if it did not, the
              only place they can find out is here. */}
          <div
            className={`workout-runner__log workout-runner__log--${logStatus}`}
            data-testid="workout-runner-log"
            data-log-status={logStatus}
            role={failed ? 'alert' : 'status'}
          >
            {logStatus === 'pending' && 'Recording to your session…'}
            {logStatus === 'ok' && 'Recorded to your session.'}
            {failed && (
              <>
                <span className="workout-runner__log-title">Not recorded</span>
                <span className="workout-runner__log-body" data-testid="workout-runner-log-error">
                  {logMessage || 'The sets you did could not be recorded.'}
                </span>
              </>
            )}
            {logStatus === 'idle' && 'Not recorded yet.'}
          </div>
        </div>

        {failed && onRetryLog && (
          <TapTarget
            testId="workout-runner-log-retry"
            label="Try again"
            sub="Record these sets"
            variant="primary"
            onActivate={() => {
              logger.info('run-log-retry', { title, completedSteps: completedRef.current.length });
              onRetryLogRef.current?.(completedRef.current);
            }}
          />
        )}

        <TapTarget
          testId="fitness-instruction-run-exit"
          label="Finish"
          variant={failed ? 'ghost' : 'primary'}
          onActivate={() => exit('complete')}
        />
      </div>
    );
  }

  const isRest = step?.kind === 'rest';
  const phase = isRest ? 'rest' : 'work';
  const exercise = isRest ? null : resolveExercise(exercises, step?.slug);

  return (
    <div className="workout-runner" data-testid="workout-runner" data-phase={phase}>
      <header className="workout-runner__bar">
        <span className="workout-runner__progress" data-testid="workout-runner-progress">
          Step {cursor + 1} of {plan.length}
        </span>
        {title && <span className="workout-runner__title">{title}</span>}
      </header>

      <div className="workout-runner__stage">
        {isRest ? (
          <RestTimer
            // Remount per step so a second rest of the same length restarts
            // rather than inheriting the previous deadline.
            key={`rest-${cursor}`}
            seconds={step.seconds}
            afterLabel={step.afterSlug ? resolveExercise(exercises, step.afterSlug).name : null}
            nextLabel={step.nextSlug ? resolveExercise(exercises, step.nextSlug).name : null}
            tickSound={restCues.tickSound}
            goSound={restCues.goSound}
            onDone={() => advanceFrom(cursor, 'rest-elapsed')}
          />
        ) : (
          <div className="workout-runner__work">
            <div className="workout-runner__demo">
              {exercise.image ? (
                <img
                  className="workout-runner__demo-img"
                  data-testid="workout-runner-demo"
                  src={exercise.image}
                  alt={exercise.name}
                />
              ) : (
                <div
                  className="workout-runner__demo-fallback"
                  data-testid="workout-runner-demo-missing"
                  aria-hidden="true"
                >
                  {exercise.name.slice(0, 1).toUpperCase()}
                </div>
              )}
            </div>

            <div className="workout-runner__facts">
              <div className="workout-runner__eyebrow" data-testid="workout-runner-group">
                {GROUP_LABELS[step.groupKind] || GROUP_LABELS.sets}
                {step.totalRounds > 1 ? ` · Round ${step.round} of ${step.totalRounds}` : ''}
              </div>

              <h2 className="workout-runner__name" data-testid="workout-runner-name">
                {exercise.name}
              </h2>

              <div className="workout-runner__set" data-testid="workout-runner-set">
                Set {step.setNumber} of {step.totalSets}
              </div>

              <div className="workout-runner__target" data-testid="workout-runner-target">
                {targetLabel(step)}
              </div>

              {step.load && (
                <div className="workout-runner__load" data-testid="workout-runner-load">
                  {step.load}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="workout-runner__next" data-testid="workout-runner-next">
        <span className="workout-runner__next-label">Next</span>
        <span className="workout-runner__next-value">
          {nextStep ? labelFor(nextStep) : 'Last one — finish strong'}
        </span>
      </div>

      <footer className="workout-runner__controls">
        <TapTarget
          testId="workout-runner-done"
          label={isRest ? 'Skip rest' : 'Done'}
          sub={isRest ? null : targetLabel(step)}
          variant="primary"
          onActivate={() => advanceFrom(cursor, isRest ? 'skip-rest' : 'done')}
        />
        <TapTarget
          testId="fitness-instruction-run-exit"
          label="End run"
          variant="ghost"
          onActivate={() => exit('abandoned')}
        />
      </footer>
    </div>
  );
}

WorkoutRunner.propTypes = {
  /** Flat ordered step list from `expandWorkout` — see the docblock above. */
  steps: PropTypes.arrayOf(PropTypes.object),
  /** slug -> { name, image }. Missing slugs render, they do not crash. */
  exercises: PropTypes.object,
  title: PropTypes.string,
  onExit: PropTypes.func,
  /** Called once with the finished WORK steps when the last step is cleared. */
  onComplete: PropTypes.func,
  /** idle | pending | ok | failed — whether the run reached the session record. */
  logStatus: PropTypes.oneOf(['idle', 'pending', 'ok', 'failed']),
  /** Plain-language reason shown when `logStatus` is 'failed'. */
  logMessage: PropTypes.string,
  /** Re-attempt the recording; the retry target only renders when this is set. */
  onRetryLog: PropTypes.func
};
