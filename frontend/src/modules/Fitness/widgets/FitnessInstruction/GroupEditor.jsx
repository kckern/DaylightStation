import React, { useCallback } from 'react';
import PropTypes from 'prop-types';
import { DaylightMediaPath } from '@/lib/api.mjs';
import './GroupEditor.scss';

/**
 * One group of a workout under construction: its kind, its passes, and its exercises.
 *
 * Presentational. Every edit is reported upward with (groupIndex, memberIndex, value) —
 * WorkoutBuilder owns the plan, so a reorder cannot half-apply here and there is one
 * place that logs what changed.
 *
 * WHICH KNOB IS SHOWN, AND WHY IT IS NOT BOTH
 * -------------------------------------------
 * The domain composes `rounds` (passes over the group) with `sets` (consecutive work at
 * one station). Showing both would ask someone standing at a rack to reason about their
 * product. So exactly one is shown, chosen by the kind the group already is:
 *
 *   straight sets (1 exercise)  -> per-exercise SETS; rounds stays 1  -> A A A
 *   superset / circuit (2+)     -> group-level ROUNDS; sets stay 1    -> A B A B A B
 *
 * That is the authoring `expandWorkout`'s docblock asks a builder to emit, reached
 * without the user ever meeting the distinction.
 *
 * REPS OR TIME, NEVER BOTH — the domain resolves a record carrying both to reps and
 * discards the seconds, so this is a toggle rather than two fields. The unused value is
 * kept in editor state (not in the payload) so flipping back does not lose what was set.
 *
 * KIND IS DERIVED — `groupKind` reads member count and nothing else. There is no
 * dropdown: a label the user can set is a label that can disagree with the structure.
 *
 * INTERACTION — onPointerDown, not onClick (see FitnessApp.jsx). Enter/Space kept.
 */

/**
 * 1 exercise is straight sets, 2 a superset, 3+ a circuit. Mirrors `groupKind` in
 * backend/src/2_domains/fitness/workout/workout.mjs — which the frontend cannot import
 * (no alias resolves `backend/src`). It is re-derived rather than sent by the server
 * because the group being edited has never been to the server; the boundary values are
 * pinned in the tests on both sides.
 */
export function groupKind(group) {
  const count = Array.isArray(group?.exercises) ? group.exercises.length : 0;
  if (count >= 3) return 'circuit';
  if (count === 2) return 'superset';
  return 'sets';
}

export const GROUP_LABELS = { sets: 'Straight sets', superset: 'Superset', circuit: 'Circuit' };

/** The derived label the group shows. */
export function groupLabel(group) {
  return GROUP_LABELS[groupKind(group)];
}

/** Clamp to a whole number inside [min, max]. */
function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function activationKey(event) {
  return event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar';
}

/** A square icon-sized tap target (move, remove, ±). */
function IconTap({ testId, label, ariaLabel, disabled = false, tone = 'plain', onActivate }) {
  const onKeyDown = useCallback((e) => {
    if (!activationKey(e)) return;
    e.preventDefault();
    if (!disabled) onActivate();
  }, [onActivate, disabled]);

  return (
    <div
      className={`group-editor__icon group-editor__icon--${tone}${disabled ? ' group-editor__icon--off' : ''}`}
      data-testid={testId}
      data-disabled={disabled ? 'true' : 'false'}
      role="button"
      aria-label={ariaLabel}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={() => { if (!disabled) onActivate(); }}
      onKeyDown={onKeyDown}
    >
      {label}
    </div>
  );
}

IconTap.propTypes = {
  testId: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  ariaLabel: PropTypes.string.isRequired,
  disabled: PropTypes.bool,
  tone: PropTypes.string,
  onActivate: PropTypes.func.isRequired
};

/**
 * −/value/+ . A stepper rather than a number input: the kiosk has no keyboard, and a
 * spinner's native arrows are far below a thumb's worth of target.
 */
export function Stepper({ testId, caption, value, display, min, max, step, onChange }) {
  const set = (next) => {
    const clamped = clamp(next, min, max);
    if (clamped !== value) onChange(clamped);
  };
  return (
    <div className="group-editor__stepper" data-testid={testId}>
      <span className="group-editor__stepper-caption">{caption}</span>
      <div className="group-editor__stepper-row">
        <IconTap
          testId={`${testId}-dec`}
          label="−"
          ariaLabel={`Decrease ${caption}`}
          disabled={value <= min}
          onActivate={() => set(value - step)}
        />
        <span className="group-editor__stepper-value" data-testid={`${testId}-value`}>{display}</span>
        <IconTap
          testId={`${testId}-inc`}
          label="+"
          ariaLabel={`Increase ${caption}`}
          disabled={value >= max}
          onActivate={() => set(value + step)}
        />
      </div>
    </div>
  );
}

Stepper.propTypes = {
  testId: PropTypes.string.isRequired,
  caption: PropTypes.string.isRequired,
  value: PropTypes.number.isRequired,
  display: PropTypes.string.isRequired,
  min: PropTypes.number.isRequired,
  max: PropTypes.number.isRequired,
  step: PropTypes.number.isRequired,
  onChange: PropTypes.func.isRequired
};

export default function GroupEditor({
  group,
  index,
  total,
  unknownSlugs = null,
  onMoveGroup,
  onRemoveGroup,
  onMerge,
  onSplit,
  onRounds,
  onMoveMember,
  onRemoveMember,
  onPatchMember
}) {
  const kind = groupKind(group);
  const members = group.exercises;
  const multi = members.length > 1;
  const id = `workout-group-${index}`;

  return (
    <section className="group-editor" data-testid={id} data-kind={kind}>
      <header className="group-editor__bar">
        <div className="group-editor__identity">
          <span className="group-editor__ordinal">{index + 1}</span>
          <span className="group-editor__kind" data-testid={`${id}-kind`}>{GROUP_LABELS[kind]}</span>
        </div>

        {/* Passes live here only for a superset/circuit; a single exercise counts them
            as sets on its own row, so showing both would be the same number twice. */}
        {multi && (
          <Stepper
            testId={`${id}-rounds`}
            caption="Rounds"
            value={group.rounds}
            display={String(group.rounds)}
            min={1}
            max={20}
            step={1}
            onChange={(next) => onRounds(index, next)}
          />
        )}

        <div className="group-editor__bar-actions">
          <IconTap
            testId={`${id}-up`}
            label="▲"
            ariaLabel={`Move group ${index + 1} earlier`}
            disabled={index === 0}
            onActivate={() => onMoveGroup(index, -1)}
          />
          <IconTap
            testId={`${id}-down`}
            label="▼"
            ariaLabel={`Move group ${index + 1} later`}
            disabled={index === total - 1}
            onActivate={() => onMoveGroup(index, 1)}
          />
          {/* Pair/unpair, the two gestures that change what a group IS. Merging with the
              next group is only offered when there is one. */}
          <IconTap
            testId={`${id}-merge`}
            label="⧉"
            ariaLabel={`Pair group ${index + 1} with the next group`}
            disabled={index >= total - 1}
            onActivate={() => onMerge(index)}
          />
          <IconTap
            testId={`${id}-split`}
            label="⧈"
            ariaLabel={`Split group ${index + 1} into single exercises`}
            disabled={!multi}
            onActivate={() => onSplit(index)}
          />
          <IconTap
            testId={`${id}-remove`}
            label="✕"
            ariaLabel={`Remove group ${index + 1}`}
            tone="danger"
            onActivate={() => onRemoveGroup(index)}
          />
        </div>
      </header>

      <div className="group-editor__members">
        {members.map((member, memberIndex) => {
          const mid = `${id}-ex-${memberIndex}`;
          const unknown = unknownSlugs instanceof Set && unknownSlugs.has(member.slug);
          const timed = member.mode === 'time';
          return (
            <div
              className={`group-editor__member${unknown ? ' group-editor__member--unknown' : ''}`}
              data-testid={mid}
              data-slug={member.slug}
              key={member.key}
            >
              <div className="group-editor__thumb">
                {member.image ? (
                  <img
                    className="group-editor__gif"
                    data-testid={`${mid}-image`}
                    src={DaylightMediaPath(member.image)}
                    alt=""
                    draggable={false}
                  />
                ) : (
                  <span className="group-editor__thumb-placeholder" aria-hidden="true">
                    {(member.name || member.slug || '?').slice(0, 1).toUpperCase()}
                  </span>
                )}
              </div>

              <div className="group-editor__member-name" data-testid={`${mid}-name`}>
                {member.name || member.slug}
                {unknown && <span className="group-editor__unknown-flag"> · not in library</span>}
              </div>

              <div className="group-editor__fields">
                {/* Sets belong to a straight-sets group only — see the docblock. */}
                {!multi && (
                  <Stepper
                    testId={`${mid}-sets`}
                    caption="Sets"
                    value={member.sets}
                    display={String(member.sets)}
                    min={1}
                    max={20}
                    step={1}
                    onChange={(next) => onPatchMember(index, memberIndex, { sets: next })}
                  />
                )}

                <div className="group-editor__mode" data-testid={`${mid}-mode`}>
                  <span className="group-editor__stepper-caption">Target</span>
                  <IconTap
                    testId={`${mid}-mode-toggle`}
                    label={timed ? 'Time' : 'Reps'}
                    ariaLabel={timed ? 'Switch target to reps' : 'Switch target to time'}
                    tone="wide"
                    onActivate={() => onPatchMember(index, memberIndex, { mode: timed ? 'reps' : 'time' })}
                  />
                </div>

                {timed ? (
                  <Stepper
                    testId={`${mid}-seconds`}
                    caption="Seconds"
                    value={member.seconds}
                    display={`${member.seconds}s`}
                    min={5}
                    max={600}
                    step={5}
                    onChange={(next) => onPatchMember(index, memberIndex, { seconds: next })}
                  />
                ) : (
                  <Stepper
                    testId={`${mid}-reps`}
                    caption="Reps"
                    value={member.reps}
                    display={String(member.reps)}
                    min={1}
                    max={50}
                    step={1}
                    onChange={(next) => onPatchMember(index, memberIndex, { reps: next })}
                  />
                )}

                {/* Load is free text in the domain ("red band"), but this screen has no
                    keyboard, so it is offered as pounds in 5 lb steps. 0 sends no load
                    at all rather than the literal "0 lb". */}
                <Stepper
                  testId={`${mid}-load`}
                  caption="Load"
                  value={member.loadLb}
                  display={member.loadLb > 0 ? `${member.loadLb} lb` : '—'}
                  min={0}
                  max={600}
                  step={5}
                  onChange={(next) => onPatchMember(index, memberIndex, { loadLb: next })}
                />

                <Stepper
                  testId={`${mid}-rest`}
                  caption="Rest"
                  value={member.restSeconds}
                  display={member.restSeconds > 0 ? `${member.restSeconds}s` : 'None'}
                  min={0}
                  max={300}
                  step={15}
                  onChange={(next) => onPatchMember(index, memberIndex, { restSeconds: next })}
                />
              </div>

              <div className="group-editor__member-actions">
                <IconTap
                  testId={`${mid}-up`}
                  label="▲"
                  ariaLabel={`Move ${member.name || member.slug} earlier in this group`}
                  disabled={memberIndex === 0}
                  onActivate={() => onMoveMember(index, memberIndex, -1)}
                />
                <IconTap
                  testId={`${mid}-down`}
                  label="▼"
                  ariaLabel={`Move ${member.name || member.slug} later in this group`}
                  disabled={memberIndex === members.length - 1}
                  onActivate={() => onMoveMember(index, memberIndex, 1)}
                />
                <IconTap
                  testId={`${mid}-remove`}
                  label="✕"
                  ariaLabel={`Remove ${member.name || member.slug}`}
                  tone="danger"
                  onActivate={() => onRemoveMember(index, memberIndex)}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

GroupEditor.propTypes = {
  group: PropTypes.shape({
    rounds: PropTypes.number.isRequired,
    exercises: PropTypes.arrayOf(PropTypes.object).isRequired
  }).isRequired,
  index: PropTypes.number.isRequired,
  total: PropTypes.number.isRequired,
  /** Slugs the server rejected as unknown, flagged in place on the offending rows. */
  unknownSlugs: PropTypes.instanceOf(Set),
  onMoveGroup: PropTypes.func.isRequired,
  onRemoveGroup: PropTypes.func.isRequired,
  onMerge: PropTypes.func.isRequired,
  onSplit: PropTypes.func.isRequired,
  onRounds: PropTypes.func.isRequired,
  onMoveMember: PropTypes.func.isRequired,
  onRemoveMember: PropTypes.func.isRequired,
  onPatchMember: PropTypes.func.isRequired
};
