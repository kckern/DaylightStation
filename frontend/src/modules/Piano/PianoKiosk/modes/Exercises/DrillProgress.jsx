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

/**
 * The placard — what this drill is CALLED. Markup and classes unchanged from
 * when it lived above the pills; only where it is mounted has moved, and it is
 * exported so the run can mount it as the screen's title.
 */
export function DrillPlacard({ label, hand = null }) {
  if (!label) return null;
  return (
    <span className="drill-placard">
      <span className="drill-placard__key">{label}</span>
      {hand && (
        <>
          <span className="drill-placard__sep">·</span>
          <span className="drill-placard__hand">{hand}</span>
        </>
      )}
    </span>
  );
}

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

function Cluster({ step, isCurrent, noteProgress, labels }) {
  const required = step.requirement?.required_passes ?? 1;
  const banked = Math.min(step.pass_count ?? 0, required);
  const done = step.passed;
  const label = labels ? (step.display?.key ?? step.title ?? '') : '';
  const badge = labels ? (HAND_BADGE[step.display?.hand] ?? null) : null;

  return (
    <div className="drill-cluster" data-active={isCurrent || undefined} data-done={done || undefined}>
      {/* A SET WITH NOTHING TO SAY SAYS NOTHING. A reading deck declares no
          label on purpose — naming the pitch under a staff a child is being
          asked to read hands them the answer — and an empty label row here
          would still have reserved its line and its gap. */}
      {(badge || label) && (
        <div className="drill-cluster__label">
          {badge && <span className="drill-cluster__badge">{badge}</span>}
          {label && <span>{label}</span>}
        </div>
      )}
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
 * @param {object|null} program a projection supplied by the HOST. When present
 *   it is used as-is and nothing is fetched — the game gate passes one because
 *   its drill is scoped to a single study day, which the learning endpoint's
 *   lifetime projection cannot express. Omit it and this fetches its own, which
 *   is what a practice mount wants.
 * @param {number} noteProgress 0..1 through the current rep's notes
 * @param {string} phase       the run's phase; 'opening' plays the flourish
 * @param {number} reloadKey   bump to re-read the projection after a pass lands
 * @param {import('react').ReactNode} fallback what to render when there are no
 *   pills to draw — the host's own standing instruction. See the note at the
 *   return below for why this cannot be `null`.
 * @param {boolean} labels whether sets are named — the placard and the cluster
 *   labels. The game gate turns them off: its run is pills and nothing else.
 * @param {(key: string|null, hand: string|null) => void} [onPlacard] told what
 *   this drill is called, so the HOST can title the screen with it. See the
 *   note above the effect below for why it is reported rather than drawn.
 */
export default function DrillProgress({
  programId, stepId, userId, program: suppliedProgram = null,
  noteProgress = 0, phase = 'playing', reloadKey = 0, fallback = null, labels = true,
  onPlacard = null,
}) {
  const [fetched, setFetched] = useState(null);
  // A host that supplies a projection OWNS it — including when it changes. The
  // fetched one is only ever a fallback, and the two never mix: reading them
  // together would let a stale lifetime projection overwrite a day-scoped one
  // the moment the endpoint answered.
  const program = suppliedProgram ?? fetched;

  // A finished run is the only thing that can have moved the projection, so
  // `settled` is the re-read signal rather than a timer: the pills refresh when
  // a rep banks and at no other point in the take.
  const settled = phase === 'done';
  useEffect(() => {
    if (suppliedProgram) return undefined;
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
      setFetched(found ?? null);
    }).catch(() => { /* no projection, no pills */ });
    return () => { alive = false; };
    // `Boolean`, not the projection itself: a host that RECOMPUTES its
    // projection every render (a deck's standing moves with the cursor) would
    // otherwise re-arm this effect at MIDI rates. All it ever asks of the prop
    // is whether there is one.
  }, [programId, userId, stepId, settled, reloadKey, Boolean(suppliedProgram)]);

  const current = useMemo(() => {
    const steps = program?.steps ?? [];
    return steps.find((step) => step.id === stepId)
      ?? steps.find((step) => step.state === 'current')
      ?? null;
  }, [program, stepId]);

  const drawsPills = (program?.steps?.length ?? 0) >= 2;

  /**
   * THE PLACARD IS THE RUN'S TITLE, AND A TITLE BELONGS AT THE TOP.
   *
   * It used to be drawn here, above the pills, which put the name of the
   * material UNDER the staff in the rail's fixed row — a heading read last,
   * competing for height with the pills, and duplicating the framing sentence
   * the header was already spending two lines on. The host now titles the
   * screen with it; this only says what it is.
   *
   * Reported as PRIMITIVES, and that is not a style choice. A host that
   * recomputes its projection every render (a deck's standing moves with the
   * cursor) would hand an object a fresh identity at MIDI rates, and an effect
   * that calls `setState` with it would re-fire on every note.
   */
  const placardKey = labels && drawsPills ? (current?.display?.key ?? current?.title ?? null) : null;
  const placardHand = placardKey ? (current?.display?.hand_label ?? null) : null;
  useEffect(() => { onPlacard?.(placardKey, placardHand); }, [onPlacard, placardKey, placardHand]);
  // The title cannot outlive the drill it names. Stable deps, so this cleanup
  // runs on unmount and at no other time.
  useEffect(() => () => onPlacard?.(null, null), [onPlacard]);

  // A single-set program is not a drill, and a row of one pill says nothing a
  // learner needs. There are no pills to read, so whatever the host would have
  // shown INSTEAD of them is what belongs here.
  //
  // `fallback` rather than `null`, and that is a fix rather than a flourish.
  // The host writes `drillProgress ?? standingInstruction`, and `drillProgress`
  // is a JSX ELEMENT — truthy whatever this renders. So a run that had no
  // projection (a one-step program, a learning endpoint that had not answered,
  // and from now on a gate drill whose ledger was unreadable) suppressed the
  // instruction line and then drew no pills either: an empty rail, and a child
  // told nothing at all about how to start. Returning the fallback from here is
  // the only place that can know, and it needs no hook in the host — which is
  // what the original attempt cost (a hook below an early return, 114 tests).
  if (!drawsPills) return fallback;

  return (
    <div className="drill-progress" data-phase={phase}>
      <div className="drill-progress__rail">
        {program.steps.map((step) => (
          <Cluster
            key={step.id}
            step={step}
            isCurrent={step.id === current?.id}
            noteProgress={noteProgress}
            labels={labels}
          />
        ))}
      </div>
    </div>
  );
}
