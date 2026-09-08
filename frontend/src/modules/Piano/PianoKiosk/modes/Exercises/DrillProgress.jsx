import { useEffect, useMemo, useState } from 'react';
import { pianoLearningApi } from './pianoLearningApi.js';
import './DrillProgress.scss';

/**
 * DrillProgress — the chrome around a multi-set drill: what you are playing,
 * and where you are in the nine reps of it.
 *
 * It reads a PROJECTED program, so it invents no state of its own. A set is a
 * program step, its `pass_count` is how many reps are banked, and its
 * `requirement.required_passes` is how many it needs — the same numbers the
 * gate itself grades on. The one thing this adds is the in-flight rep, which
 * has no pass yet and is drawn as a ring filling with the notes of the take.
 *
 * A rep cannot FAIL here, by design: a missed take drains the ring and you go
 * again, so the row only ever moves forward and there is no failure colour to
 * design around.
 *
 * Hands are labelled `RH` / `LH` / `RH+LH` rather than with clef glyphs.
 * U+1D11E and friends render as tofu in the kiosk WebView (the same reason
 * every other icon on this surface is inline SVG), and a two-letter label is
 * legible at a glance besides.
 */

const HAND_BADGE = { R: 'RH', L: 'LH', RL: 'RH+LH' };

/** The circumference the pill ring's dash array is cut from. r = 14. */
const RING_LENGTH = 88;

function Pill({ state, progress }) {
  const offset = RING_LENGTH - RING_LENGTH * (state === 'banked' ? 1 : progress);
  return (
    <div className="drill-pill" data-state={state}>
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <circle className="drill-pill__track" cx="16" cy="16" r="14" />
        <circle className="drill-pill__ring" cx="16" cy="16" r="14" style={{ strokeDashoffset: offset }} />
      </svg>
      <span className="drill-pill__core" />
    </div>
  );
}

function Cluster({ step, isCurrent, noteProgress }) {
  const required = step.requirement?.required_passes ?? 1;
  const banked = Math.min(step.pass_count ?? 0, required);
  const done = step.passed;
  const label = step.display?.key ?? step.title ?? '';
  const badge = HAND_BADGE[step.display?.hand] ?? null;

  return (
    <div className="drill-cluster" data-active={isCurrent || undefined} data-done={done || undefined}>
      <div className="drill-cluster__label">
        {badge && <span className="drill-cluster__badge">{badge}</span>}
        <span>{label}</span>
      </div>
      <div className="drill-cluster__pills">
        {Array.from({ length: required }, (_, rep) => {
          const state = done || rep < banked ? 'banked' : (isCurrent && rep === banked ? 'current' : 'todo');
          return <Pill key={rep} state={state} progress={state === 'current' ? noteProgress : 0} />;
        })}
      </div>
      <div className="drill-cluster__rollup">
        <i style={{ width: `${(done ? required : banked) / required * 100}%` }} />
      </div>
    </div>
  );
}

/**
 * @param {string} programId   the drill being run
 * @param {string} stepId      the set this run belongs to
 * @param {string} userId      whose attempts project the program
 * @param {number} noteProgress 0..1 through the current rep's notes
 * @param {string} phase       the run's phase; 'opening' plays the flourish
 * @param {number} reloadKey   bump to re-read the projection after a pass lands
 */
export default function DrillProgress({
  programId, stepId, userId, noteProgress = 0, phase = 'playing', reloadKey = 0,
}) {
  const [program, setProgram] = useState(null);

  // A finished run is the only thing that can have moved the projection, so
  // `settled` is the re-read signal rather than a timer: the pills refresh when
  // a rep banks and at no other point in the take.
  const settled = phase === 'done';
  useEffect(() => {
    if (!programId || !userId) return undefined;
    // Optional-call, and check we got a thenable back. This is chrome around
    // somebody's practice, not the practice itself: if the learning endpoint
    // is absent or shaped differently than expected, the right outcome is no
    // pills — never an exception that takes the run stage down with it.
    const pending = pianoLearningApi.learning?.(userId);
    if (typeof pending?.then !== 'function') return undefined;
    let alive = true;
    pending.then((result) => {
      if (!alive || !result?.ok) return;
      const found = (result.data?.programs ?? []).find((entry) => entry.id === programId);
      setProgram(found ?? null);
    }).catch(() => { /* no projection, no pills */ });
    return () => { alive = false; };
  }, [programId, userId, stepId, settled, reloadKey]);

  const current = useMemo(() => {
    const steps = program?.steps ?? [];
    return steps.find((step) => step.id === stepId)
      ?? steps.find((step) => step.state === 'current')
      ?? null;
  }, [program, stepId]);

  // A single-set program is not a drill, and a row of one pill says nothing a
  // learner needs. Render nothing rather than decorate.
  if (!program || (program.steps?.length ?? 0) < 2) return null;

  return (
    <div className="drill-progress" data-phase={phase}>
      {current && (
        <div className="drill-placard">
          <span className="drill-placard__key">{current.display?.key ?? current.title}</span>
          {current.display?.hand_label && (
            <>
              <span className="drill-placard__sep">·</span>
              <span className="drill-placard__hand">{current.display.hand_label}</span>
            </>
          )}
        </div>
      )}
      <div className="drill-progress__rail">
        {program.steps.map((step) => (
          <Cluster
            key={step.id}
            step={step}
            isCurrent={step.id === current?.id}
            noteProgress={noteProgress}
          />
        ))}
      </div>
    </div>
  );
}
