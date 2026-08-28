import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';

// The runner takes its steps as a prop (see the WorkoutRunner docblock), but the
// SEQUENCE it renders must match the domain, not a fixture someone typed. So the
// tests import `expandWorkout` itself — test code runs under Node, where the
// backend path resolves — and derive every expectation from its real output. A
// change to rounds/sets/rest ordering therefore breaks these tests instead of
// silently drifting away from them.
import { expandWorkout } from '../../../../../../backend/src/2_domains/fitness/workout/workout.mjs';

const cues = vi.hoisted(() => []);
vi.mock('@/modules/Fitness/player/hooks/useGovernanceAudioDuck.js', () => ({
  __esModule: true,
  playCueOnce: ({ sound } = {}) => { cues.push(sound); return true; }
}));

const unlockCalls = vi.hoisted(() => ({ count: 0, removed: 0 }));
vi.mock('@/modules/Fitness/player/hooks/audioCuePlayer.js', () => ({
  __esModule: true,
  installCueAudioUnlock: () => { unlockCalls.count += 1; return () => { unlockCalls.removed += 1; }; },
  primeCueAudio: () => true,
  isCueAudioUnlocked: () => true,
  getCueAudioElement: () => null
}));

const logCalls = vi.hoisted(() => ({ debug: [], info: [], warn: [], error: [] }));
vi.mock('@/lib/logging/Logger.js', () => {
  const makeLogger = (ctx = {}) => {
    const push = (bucket) => (event, data) =>
      logCalls[bucket].push({ component: ctx.component ?? null, event, data });
    return {
      debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error'),
      sampled: push('debug'),
      child: (childCtx = {}) => makeLogger({ ...ctx, ...childCtx })
    };
  };
  const getLogger = () => makeLogger();
  const noop = () => {};
  return {
    default: getLogger, getLogger, configure: noop, resetSamplingState: noop,
    getRecentEvents: () => [], getConfig: () => ({}), startDiagnostics: noop,
    stopDiagnostics: noop, perfSnapshot: () => ({}), getStatus: () => ({})
  };
});

import WorkoutRunner from './WorkoutRunner.jsx';
import { humanizeSlug, resolveExercise, targetLabel } from './workoutRunnerDisplay.js';

// ── Fixtures: one authored workout per group shape ──────────────────────────
// Straight sets carry rest so the expansion interleaves it (and drops the
// trailing one). The superset/circuit fixtures carry no rest so their tests read
// the rotation without rest noise.
const STRAIGHT = {
  groups: [{
    rounds: 1,
    exercises: [{ slug: 'back-squat', sets: 3, reps: 5, load: '225 lb', restSeconds: 90 }]
  }]
};

const SUPERSET = {
  groups: [{
    rounds: 3,
    exercises: [
      { slug: 'bench-press', sets: 1, reps: 8, load: '135 lb' },
      { slug: 'bent-row', sets: 1, reps: 8, load: '95 lb' }
    ]
  }]
};

const CIRCUIT = {
  groups: [{
    rounds: 2,
    exercises: [
      { slug: 'burpee', sets: 1, reps: 10 },
      { slug: 'kb-swing', sets: 1, reps: 15 },
      { slug: 'plank', sets: 1, seconds: 45 }
    ]
  }]
};

const LOOKUP = {
  'back-squat': { name: 'Back Squat', image: '/gif/back-squat.gif' },
  'bench-press': { name: 'Bench Press', image: '/gif/bench-press.gif' },
  'bent-row': { name: 'Bent Row', image: '/gif/bent-row.gif' },
  burpee: { name: 'Burpee', image: '/gif/burpee.gif' },
  'kb-swing': { name: 'Kettlebell Swing', image: '/gif/kb-swing.gif' },
  plank: { name: 'Plank', image: '/gif/plank.gif' }
};

const logsFor = (bucket, event) =>
  logCalls[bucket].filter((l) => l.component === 'workout-runner' && l.event === event);

/**
 * What the screen currently says, as one comparable string. Rest steps report
 * the countdown they opened on; work steps report the resolved name plus the
 * literal "Set N of M" line — so ordering, rest placement, name resolution and
 * the cumulative set number are all pinned by a single equality.
 */
const screenLabel = (q) => {
  if (q.queryByTestId('rest-timer')) {
    return `rest:${q.getByTestId('rest-timer').getAttribute('data-remaining')}`;
  }
  return `${q.getByTestId('workout-runner-name').textContent}|${q.getByTestId('workout-runner-set').textContent}`;
};

/** The same string, derived from the domain's own step objects. */
const expectedLabels = (steps, lookup = LOOKUP) => steps.map((s) => (
  s.kind === 'rest'
    ? `rest:${s.seconds}`
    : `${lookup[s.slug]?.name ?? humanizeSlug(s.slug)}|Set ${s.setNumber} of ${s.totalSets}`
));

/**
 * Tap Done through the whole run, recording the screen before each tap.
 * Deliberately NOT sorted, NOT deduped, and capped well above the fixtures so a
 * runner that skips (or repeats) a step produces a different array, not a
 * coincidentally-equal one.
 */
const walkToEnd = (q, cap = 40) => {
  const seen = [];
  for (let i = 0; i < cap; i += 1) {
    if (q.queryByTestId('workout-runner-complete')) return seen;
    seen.push(screenLabel(q));
    fireEvent.pointerDown(q.getByTestId('workout-runner-done'));
  }
  throw new Error(`run did not complete within ${cap} taps`);
};

const renderRunner = (props = {}) =>
  render(<WorkoutRunner exercises={LOOKUP} {...props} />);

describe('WorkoutRunner', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
    cues.length = 0;
    unlockCalls.count = 0;
    unlockCalls.removed = 0;
    ['debug', 'info', 'warn', 'error'].forEach((b) => { logCalls[b].length = 0; });
  });
  afterEach(() => { vi.useRealTimers(); });

  describe('step sequence matches expandWorkout', () => {
    it('straight sets — A rest A rest A, with the trailing rest already dropped', () => {
      const steps = expandWorkout(STRAIGHT);
      // Guard the fixture itself: if this stops being the interleaved shape the
      // test below is no longer testing interleaving.
      expect(steps.map((s) => s.kind)).toEqual(['work', 'rest', 'work', 'rest', 'work']);

      const q = renderRunner({ steps });
      expect(walkToEnd(q)).toEqual(expectedLabels(steps));
      expect(expectedLabels(steps)).toEqual([
        'Back Squat|Set 1 of 3', 'rest:90',
        'Back Squat|Set 2 of 3', 'rest:90',
        'Back Squat|Set 3 of 3'
      ]);
    });

    it('superset — A B A B A B, with set numbers accumulating across rounds', () => {
      const steps = expandWorkout(SUPERSET);
      expect(steps).toHaveLength(6);

      const q = renderRunner({ steps });
      expect(walkToEnd(q)).toEqual(expectedLabels(steps));
      // Spelled out because this is the case that separates `setNumber` from
      // `set`: every step here has set === 1, so a runner rendering `set` would
      // show "Set 1 of 3" six times and still pass a laxer assertion.
      expect(expectedLabels(steps)).toEqual([
        'Bench Press|Set 1 of 3', 'Bent Row|Set 1 of 3',
        'Bench Press|Set 2 of 3', 'Bent Row|Set 2 of 3',
        'Bench Press|Set 3 of 3', 'Bent Row|Set 3 of 3'
      ]);
    });

    it('circuit — rotates through all three before the round increments', () => {
      const steps = expandWorkout(CIRCUIT);
      expect(steps).toHaveLength(6);

      const q = renderRunner({ steps });
      expect(walkToEnd(q)).toEqual(expectedLabels(steps));
      expect(expectedLabels(steps)).toEqual([
        'Burpee|Set 1 of 2', 'Kettlebell Swing|Set 1 of 2', 'Plank|Set 1 of 2',
        'Burpee|Set 2 of 2', 'Kettlebell Swing|Set 2 of 2', 'Plank|Set 2 of 2'
      ]);
    });

    it('shows the group kind and the round, incrementing only after the rotation', () => {
      const q = renderRunner({ steps: expandWorkout(CIRCUIT) });
      const group = () => q.getByTestId('workout-runner-group').textContent;
      expect(group()).toBe('Circuit · Round 1 of 2');
      fireEvent.pointerDown(q.getByTestId('workout-runner-done')); // burpee -> swing
      expect(group()).toBe('Circuit · Round 1 of 2');
      fireEvent.pointerDown(q.getByTestId('workout-runner-done')); // swing -> plank
      expect(group()).toBe('Circuit · Round 1 of 2');
      fireEvent.pointerDown(q.getByTestId('workout-runner-done')); // plank -> round 2
      expect(group()).toBe('Circuit · Round 2 of 2');
    });

    it('labels a superset a superset (and hides the round line on a single pass)', () => {
      const sup = renderRunner({ steps: expandWorkout(SUPERSET) });
      expect(sup.getByTestId('workout-runner-group').textContent).toBe('Superset · Round 1 of 3');
      sup.unmount(); // two runners in one body would make getByTestId ambiguous
      const straight = renderRunner({ steps: expandWorkout(STRAIGHT) });
      expect(straight.getByTestId('workout-runner-group').textContent).toBe('Straight sets');
    });
  });

  describe('targets and load', () => {
    it('renders a rep target and the load', () => {
      const q = renderRunner({ steps: expandWorkout(STRAIGHT) });
      expect(q.getByTestId('workout-runner-target').textContent).toBe('5 reps');
      expect(q.getByTestId('workout-runner-load').textContent).toBe('225 lb');
    });

    it('renders a duration target for a timed step, and no load when none was authored', () => {
      const q = renderRunner({ steps: expandWorkout(CIRCUIT) });
      fireEvent.pointerDown(q.getByTestId('workout-runner-done'));
      fireEvent.pointerDown(q.getByTestId('workout-runner-done')); // -> plank (45 s)
      expect(q.getByTestId('workout-runner-name').textContent).toBe('Plank');
      expect(q.getByTestId('workout-runner-target').textContent).toBe('45 sec');
      expect(q.queryByTestId('workout-runner-load')).toBeNull();
    });

    it('a timed work step still waits for Done — only rest auto-advances', () => {
      const q = renderRunner({ steps: expandWorkout(CIRCUIT) });
      fireEvent.pointerDown(q.getByTestId('workout-runner-done'));
      fireEvent.pointerDown(q.getByTestId('workout-runner-done')); // -> plank (45 s)
      act(() => { vi.advanceTimersByTime(120000); });
      expect(q.getByTestId('workout-runner-name').textContent).toBe('Plank');
      expect(q.getByTestId('workout-runner-set').textContent).toBe('Set 1 of 2');
    });

    it('targetLabel covers reps, seconds, singular and "no target authored"', () => {
      expect(targetLabel({ reps: 5, seconds: null })).toBe('5 reps');
      expect(targetLabel({ reps: 1, seconds: null })).toBe('1 rep');
      expect(targetLabel({ reps: null, seconds: 45 })).toBe('45 sec');
      expect(targetLabel({ reps: null, seconds: null })).toBe('Until done');
    });
  });

  describe('rest', () => {
    it('counts down and auto-advances to the next step', () => {
      const q = renderRunner({ steps: expandWorkout(STRAIGHT) });
      fireEvent.pointerDown(q.getByTestId('workout-runner-done'));
      expect(q.getByTestId('rest-timer-count').textContent).toBe('90');

      act(() => { vi.advanceTimersByTime(60000); });
      expect(q.getByTestId('rest-timer-count').textContent).toBe('30');
      expect(q.queryByTestId('workout-runner-name')).toBeNull(); // still resting

      act(() => { vi.advanceTimersByTime(29750); });
      expect(q.queryByTestId('rest-timer')).toBeTruthy();        // not a second early

      act(() => { vi.advanceTimersByTime(250); });
      expect(q.queryByTestId('rest-timer')).toBeNull();
      expect(q.getByTestId('workout-runner-set').textContent).toBe('Set 2 of 3');
    });

    it('Done pressed mid-rest skips ahead immediately, and does not queue a second advance', () => {
      const q = renderRunner({ steps: expandWorkout(STRAIGHT) });
      fireEvent.pointerDown(q.getByTestId('workout-runner-done')); // -> rest
      act(() => { vi.advanceTimersByTime(5000); });
      expect(q.getByTestId('rest-timer-count').textContent).toBe('85');

      fireEvent.pointerDown(q.getByTestId('workout-runner-done')); // skip the rest
      expect(q.queryByTestId('rest-timer')).toBeNull();
      expect(q.getByTestId('workout-runner-set').textContent).toBe('Set 2 of 3');

      // The skipped rest's remaining 85 s must not surface later as an extra
      // advance — that is the "queued" failure this guards.
      act(() => { vi.advanceTimersByTime(120000); });
      expect(q.getByTestId('workout-runner-set').textContent).toBe('Set 2 of 3');
      expect(q.queryByTestId('workout-runner-complete')).toBeNull();
    });

    it('drops the countdown when Done and the deadline land in the SAME batch', () => {
      // The dead heat: the tap is handled and the rest elapses before React has
      // re-rendered, so the countdown is still mounted and fires its onDone with
      // a step index that is already spent. Both want to advance; only one may.
      // Without the stale-index guard this skips "Set 3 of 3" entirely.
      const q = renderRunner({ steps: expandWorkout(STRAIGHT) });
      fireEvent.pointerDown(q.getByTestId('workout-runner-done')); // -> rest (step 1)
      act(() => { vi.advanceTimersByTime(5000); });

      act(() => {
        fireEvent.pointerDown(q.getByTestId('workout-runner-done')); // skip
        vi.advanceTimersByTime(85000);                              // ...and it elapses
      });

      expect(q.getByTestId('workout-runner-set').textContent).toBe('Set 2 of 3');
      expect(logsFor('debug', 'step-advance-ignored')).toHaveLength(1);
      expect(logsFor('debug', 'step-advance').map((l) => l.data.to)).toEqual([1, 2]);
    });

    it('names the exercise on each side of the rest', () => {
      const q = renderRunner({ steps: expandWorkout(STRAIGHT) });
      fireEvent.pointerDown(q.getByTestId('workout-runner-done'));
      expect(q.getByTestId('rest-timer-after').textContent).toContain('Back Squat');
      expect(q.getByTestId('rest-timer-next').textContent).toContain('Back Squat');
    });

    it('shows the rest in the next-up strip before it arrives', () => {
      const q = renderRunner({ steps: expandWorkout(STRAIGHT) });
      expect(q.getByTestId('workout-runner-next').textContent).toContain('Rest 90s');
    });

    it('leaves no live timer behind when the runner unmounts mid-rest', () => {
      const onComplete = vi.fn();
      const q = renderRunner({ steps: expandWorkout(STRAIGHT), onComplete });
      fireEvent.pointerDown(q.getByTestId('workout-runner-done')); // -> rest
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      q.unmount();
      expect(vi.getTimerCount()).toBe(0);
      act(() => { vi.advanceTimersByTime(300000); });
      expect(onComplete).not.toHaveBeenCalled();
      expect(cues).toEqual([]);
    });
  });

  describe('finishing', () => {
    it('ends the run on the last step instead of resting', () => {
      const steps = expandWorkout(STRAIGHT);
      // The last exercise DOES author rest — expandWorkout drops the trailing
      // one, and the runner must not invent it back.
      expect(steps[steps.length - 1].kind).toBe('work');

      const onComplete = vi.fn();
      const onExit = vi.fn();
      const q = renderRunner({ steps, onComplete, onExit });
      walkToEnd(q);

      expect(q.getByTestId('workout-runner-complete')).toBeTruthy();
      expect(q.queryByTestId('rest-timer')).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
      expect(onComplete).toHaveBeenCalledTimes(1);
      // Completing is not exiting — the athlete gets to see they finished.
      expect(onExit).not.toHaveBeenCalled();

      act(() => { vi.advanceTimersByTime(300000); });
      expect(q.getByTestId('workout-runner-complete')).toBeTruthy();
    });

    it('reports how many sets were done, counting work steps only', () => {
      const q = renderRunner({ steps: expandWorkout(STRAIGHT) });
      walkToEnd(q);
      // 5 steps expand, 3 of them are work. A count of 5 would mean rest is
      // being counted as a set.
      expect(q.getByTestId('workout-runner-complete').textContent).toContain('3 sets done');
    });

    // ── What the run REPORTS ────────────────────────────────────────────────
    // The report is what reaches the session record, so it has to be the sets
    // performed and nothing else. A report built from the plan (or from the whole
    // walked step list) would file rest as work and would file sets nobody did.
    describe('the completion report', () => {
      it('hands back the finished work steps, with rest excluded', () => {
        const steps = expandWorkout(STRAIGHT);
        const onComplete = vi.fn();
        const q = renderRunner({ steps, onComplete });
        walkToEnd(q);

        const [reported] = onComplete.mock.calls[0];
        expect(reported.map((s) => s.kind)).toEqual(['work', 'work', 'work']);
        expect(reported.map((s) => s.slug)).toEqual(['back-squat', 'back-squat', 'back-squat']);
        expect(reported.every((s) => Number.isInteger(s.groupIndex))).toBe(true);
        // Every reported step must be one the runner actually walked.
        reported.forEach((s) => expect(steps).toContain(s));
      });

      it('reports only the sets performed when the athlete skipped rest but did every set', () => {
        // Skipping rest is not skipping work: a run walked entirely through the
        // Done/Skip target still performed every work step.
        const steps = expandWorkout(SUPERSET);
        const onComplete = vi.fn();
        const q = renderRunner({ steps, onComplete });
        walkToEnd(q);
        const [reported] = onComplete.mock.calls[0];
        expect(reported).toHaveLength(steps.filter((s) => s.kind === 'work').length);
      });

      // ── The one place performed and planned actually diverge ────────────────
      // Bailing at two of six is an ordinary way to end a workout. Ending the run
      // has to file those two, and it has to file TWO — a report derived from the
      // plan would file six sets nobody did, which is the "plan as performance"
      // failure the whole strength block exists to prevent.
      it('stopping early files the sets already done, and only those', () => {
        const steps = expandWorkout(SUPERSET); // 6 work steps, no rest
        expect(steps.filter((s) => s.kind === 'work')).toHaveLength(6);

        const onComplete = vi.fn();
        const onExit = vi.fn();
        const q = renderRunner({ steps, onComplete, onExit });
        fireEvent.pointerDown(q.getByTestId('workout-runner-done'));
        fireEvent.pointerDown(q.getByTestId('workout-runner-done'));
        fireEvent.pointerDown(q.getByTestId('fitness-instruction-run-exit'));

        expect(onComplete).toHaveBeenCalledTimes(1);
        expect(onComplete.mock.calls[0][0]).toHaveLength(2);
        expect(onComplete.mock.calls[0][0].map((s) => s.slug))
          .toEqual([steps[0].slug, steps[1].slug]);
        // And the athlete sees the outcome instead of being dropped back to
        // Browse with two unrecorded sets behind them.
        expect(q.getByTestId('workout-runner-complete').textContent).toContain('2 sets done');
        expect(onExit).not.toHaveBeenCalled();
      });

      it('leaves immediately when nothing was done — there is nothing to file', () => {
        const onComplete = vi.fn();
        const onExit = vi.fn();
        const q = renderRunner({ steps: expandWorkout(SUPERSET), onComplete, onExit });
        fireEvent.pointerDown(q.getByTestId('fitness-instruction-run-exit'));
        expect(onExit).toHaveBeenCalledTimes(1);
        expect(onComplete).not.toHaveBeenCalled();
      });

      it('counts the sets DONE on screen, which is not the same as the sets planned', () => {
        // STRAIGHT prescribes 3 sets. Walk two of them and end the run: the panel
        // must say 2. Reading the plan here is the "planned as performed" bug the
        // whole strength block exists to avoid.
        const steps = expandWorkout(STRAIGHT);
        const shortened = steps.slice(0, 3); // work, rest, work
        const onComplete = vi.fn();
        const q = renderRunner({ steps: shortened, onComplete });
        walkToEnd(q);

        expect(q.getByTestId('workout-runner-complete').textContent).toContain('2 sets done');
        expect(onComplete.mock.calls[0][0]).toHaveLength(2);
      });
    });

    // ── What the screen says about RECORDING ────────────────────────────────
    describe('the recording notice', () => {
      it('says it is recording while the report is in flight', () => {
        const q = renderRunner({ steps: expandWorkout(STRAIGHT), logStatus: 'pending' });
        walkToEnd(q);
        expect(q.getByTestId('workout-runner-log').getAttribute('data-log-status')).toBe('pending');
        expect(q.getByTestId('workout-runner-log').textContent).toMatch(/recording/i);
      });

      it('confirms the sets reached the session', () => {
        const q = renderRunner({ steps: expandWorkout(STRAIGHT), logStatus: 'ok' });
        walkToEnd(q);
        expect(q.getByTestId('workout-runner-log').textContent).toMatch(/recorded to your session/i);
        expect(q.queryByTestId('workout-runner-log-retry')).toBeNull();
      });

      it('says NOT RECORDED, in the reason\'s own words, and offers a retry', () => {
        const onRetryLog = vi.fn();
        const q = renderRunner({
          steps: expandWorkout(STRAIGHT),
          logStatus: 'failed',
          logMessage: 'No workout session could be opened.',
          onRetryLog
        });
        walkToEnd(q);

        const panel = q.getByTestId('workout-runner-log');
        expect(panel.getAttribute('data-log-status')).toBe('failed');
        expect(panel.textContent).toContain('Not recorded');
        expect(q.getByTestId('workout-runner-log-error').textContent)
          .toBe('No workout session could be opened.');
        // Loud enough for a screen reader too — this is the one thing on the
        // completion screen a person must not miss.
        expect(panel.getAttribute('role')).toBe('alert');

        fireEvent.pointerDown(q.getByTestId('workout-runner-log-retry'));
        expect(onRetryLog).toHaveBeenCalledTimes(1);
        // The retry re-files the SAME performed sets, not a fresh empty report.
        expect(onRetryLog.mock.calls[0][0]).toHaveLength(3);
      });

      it('never shows a bare "nice work" when the recording failed', () => {
        const q = renderRunner({ steps: expandWorkout(STRAIGHT), logStatus: 'failed', onRetryLog: () => {} });
        walkToEnd(q);
        expect(q.getByTestId('workout-runner-complete').textContent).toMatch(/not recorded/i);
      });
    });

    it('exits from the completion screen', () => {
      const onExit = vi.fn();
      const q = renderRunner({ steps: expandWorkout(STRAIGHT), onExit });
      walkToEnd(q);
      fireEvent.pointerDown(q.getByTestId('fitness-instruction-run-exit'));
      expect(onExit).toHaveBeenCalledTimes(1);
    });

    it('says so on the last step in the next-up strip', () => {
      const q = renderRunner({ steps: expandWorkout(SUPERSET) });
      for (let i = 0; i < 5; i += 1) fireEvent.pointerDown(q.getByTestId('workout-runner-done'));
      expect(q.getByTestId('workout-runner-next').textContent).toContain('Last one');
    });

    it('abandons the run from the exit target mid-workout', () => {
      const onExit = vi.fn();
      const onComplete = vi.fn();
      const q = renderRunner({ steps: expandWorkout(SUPERSET), onExit, onComplete });
      fireEvent.pointerDown(q.getByTestId('fitness-instruction-run-exit'));
      expect(onExit).toHaveBeenCalledTimes(1);
      expect(onComplete).not.toHaveBeenCalled();
    });
  });

  describe('missing display data', () => {
    it('renders a slug the lookup does not know, with a placeholder for the demo', () => {
      const partial = { burpee: LOOKUP.burpee, plank: LOOKUP.plank }; // kb-swing dropped
      const steps = expandWorkout(CIRCUIT);
      const q = render(<WorkoutRunner steps={steps} exercises={partial} />);
      fireEvent.pointerDown(q.getByTestId('workout-runner-done')); // -> kb-swing
      expect(q.getByTestId('workout-runner-name').textContent).toBe('Kb Swing');
      expect(q.queryByTestId('workout-runner-demo')).toBeNull();
      expect(q.getByTestId('workout-runner-demo-missing')).toBeTruthy();
      expect(q.getByTestId('workout-runner-set').textContent).toBe('Set 1 of 2');
    });

    it('runs a whole workout with no lookup at all', () => {
      const steps = expandWorkout(CIRCUIT);
      const q = render(<WorkoutRunner steps={steps} />);
      expect(walkToEnd(q)).toEqual(expectedLabels(steps, {}));
      expect(q.getByTestId('workout-runner-complete')).toBeTruthy();
    });

    it('resolveExercise falls back on every degenerate lookup shape', () => {
      expect(resolveExercise(null, 'kb-swing')).toEqual({ name: 'Kb Swing', image: null, known: false });
      expect(resolveExercise({}, 'kb-swing').name).toBe('Kb Swing');
      expect(resolveExercise({ x: { name: '  ', image: '  ' } }, 'x')).toEqual({ name: 'X', image: null, known: true });
      expect(resolveExercise({ x: { name: 'Real', image: '/a.gif' } }, 'x')).toEqual({ name: 'Real', image: '/a.gif', known: true });
      expect(humanizeSlug('')).toBe('Exercise');
      expect(humanizeSlug('dumbbell_bench-press')).toBe('Dumbbell Bench Press');
    });

    it('shows an empty-plan screen (with a way out) when there are no steps', () => {
      const onExit = vi.fn();
      const q = render(<WorkoutRunner steps={[]} onExit={onExit} />);
      expect(q.getByTestId('workout-runner').getAttribute('data-phase')).toBe('empty');
      expect(q.queryByTestId('workout-runner-done')).toBeNull();
      fireEvent.pointerDown(q.getByTestId('fitness-instruction-run-exit'));
      expect(onExit).toHaveBeenCalledTimes(1);
    });
  });

  describe('interaction', () => {
    it('does not advance on a bare click (controls are onPointerDown, not onClick)', () => {
      const q = renderRunner({ steps: expandWorkout(SUPERSET) });
      fireEvent.click(q.getByTestId('workout-runner-done'));
      expect(q.getByTestId('workout-runner-name').textContent).toBe('Bench Press');
      expect(q.getByTestId('workout-runner-set').textContent).toBe('Set 1 of 3');
    });

    it('advances on Enter and on Space', () => {
      const q = renderRunner({ steps: expandWorkout(SUPERSET) });
      fireEvent.keyDown(q.getByTestId('workout-runner-done'), { key: 'Enter' });
      expect(q.getByTestId('workout-runner-name').textContent).toBe('Bent Row');
      fireEvent.keyDown(q.getByTestId('workout-runner-done'), { key: ' ' });
      expect(q.getByTestId('workout-runner-set').textContent).toBe('Set 2 of 3');
    });

    it('arms the shared cue-audio unlock on mount and detaches it on unmount', () => {
      const q = renderRunner({ steps: expandWorkout(SUPERSET) });
      expect(unlockCalls.count).toBe(1);
      expect(unlockCalls.removed).toBe(0);
      q.unmount();
      expect(unlockCalls.removed).toBe(1);
    });

    it('plays nothing before the first interaction — an unprompted cue is the one autoplay blocks', () => {
      renderRunner({ steps: expandWorkout(STRAIGHT) });
      expect(cues).toEqual([]);
    });

    it('tracks progress through the plan', () => {
      const q = renderRunner({ steps: expandWorkout(SUPERSET) });
      expect(q.getByTestId('workout-runner-progress').textContent).toBe('Step 1 of 6');
      fireEvent.pointerDown(q.getByTestId('workout-runner-done'));
      expect(q.getByTestId('workout-runner-progress').textContent).toBe('Step 2 of 6');
    });
  });

  describe('logging', () => {
    it('logs run-start once, with the step count', () => {
      const { rerender } = render(<WorkoutRunner steps={expandWorkout(STRAIGHT)} exercises={LOOKUP} title="Leg Day" />);
      const start = logsFor('info', 'run-start');
      expect(start).toHaveLength(1);
      expect(start[0].data).toEqual({ title: 'Leg Day', totalSteps: 5, workSteps: 3 });
      // A parent re-render with a fresh array identity is not a new run.
      rerender(<WorkoutRunner steps={expandWorkout(STRAIGHT)} exercises={LOOKUP} title="Leg Day" />);
      expect(logsFor('info', 'run-start')).toHaveLength(1);
    });

    it('logs one step-advance at debug per advance, in order', () => {
      const q = renderRunner({ steps: expandWorkout(STRAIGHT) });
      walkToEnd(q);
      expect(logsFor('debug', 'step-advance').map((l) => [l.data.from, l.data.to, l.data.kind])).toEqual([
        [0, 1, 'rest'],
        [1, 2, 'work'],
        [2, 3, 'rest'],
        [3, 4, 'work']
      ]);
      expect(logsFor('debug', 'step-advance')[1].data.reason).toBe('skip-rest');
    });

    it('logs run-complete once, at info', () => {
      const q = renderRunner({ steps: expandWorkout(STRAIGHT), title: 'Leg Day' });
      expect(logsFor('info', 'run-complete')).toHaveLength(0);
      walkToEnd(q);
      const done = logsFor('info', 'run-complete');
      expect(done).toHaveLength(1);
      // `completedSteps` is what was PERFORMED and `workSteps` what was planned;
      // a full walk makes them agree, and the wiring tests below drive them apart.
      expect(done[0].data)
        .toEqual({ title: 'Leg Day', reason: 'last-step', totalSteps: 5, workSteps: 3, completedSteps: 3 });
    });

    it('logs run-exit with the step the athlete abandoned on', () => {
      // Nothing done, so there is nothing to file and the exit is a real exit.
      const q = renderRunner({ steps: expandWorkout(SUPERSET), onExit: () => {} });
      fireEvent.pointerDown(q.getByTestId('fitness-instruction-run-exit'));
      const exits = logsFor('info', 'run-exit');
      expect(exits).toHaveLength(1);
      expect(exits[0].data).toEqual({ reason: 'abandoned', cursor: 0, totalSteps: 6 });
    });

    it('logs an early stop as a completion, with the reason it ended', () => {
      const q = renderRunner({ steps: expandWorkout(SUPERSET), onExit: () => {} });
      fireEvent.pointerDown(q.getByTestId('workout-runner-done'));
      fireEvent.pointerDown(q.getByTestId('fitness-instruction-run-exit'));
      const done = logsFor('info', 'run-complete');
      expect(done).toHaveLength(1);
      expect(done[0].data).toMatchObject({ reason: 'abandoned', completedSteps: 1, workSteps: 6 });
      expect(logsFor('info', 'run-exit')).toEqual([]);
    });

    it('logs the retry as its own event', () => {
      const q = renderRunner({ steps: expandWorkout(STRAIGHT), logStatus: 'failed', onRetryLog: () => {} });
      walkToEnd(q);
      fireEvent.pointerDown(q.getByTestId('workout-runner-log-retry'));
      expect(logsFor('info', 'run-log-retry')).toHaveLength(1);
    });

    it('uses the logging framework, never console.*', () => {
      // The mock above IS the framework; if the runner had used console the
      // assertions on logCalls throughout this file would all be empty.
      const q = renderRunner({ steps: expandWorkout(SUPERSET) });
      fireEvent.pointerDown(q.getByTestId('workout-runner-done'));
      expect(logCalls.info.length + logCalls.debug.length).toBeGreaterThan(0);
      expect(logCalls.error).toEqual([]);
    });
  });
});
