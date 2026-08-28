import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import getLogger from '@/lib/logging/Logger.js';
import { DaylightAPI } from '@/lib/api.mjs';
import GroupEditor from './GroupEditor.jsx';
import { groupKind } from './groupKindModel.js';
import {
  WORKOUTS_PATH, RUN_PATH,
  defaultWorkoutTitle, makeGroup, effectivePasses, mergeGroups,
  splitGroup, moveItem, toPayload, totalWorkSteps, parseSaveError, toDisplayList,
} from './workoutBuilderModel.js';
import './WorkoutBuilder.scss';

/**
 * Build — turn the tray Browse handed over into a workout Run can walk.
 *
 * THE MODEL, AND THE ONE RULE ABOUT IT
 * ------------------------------------
 * A workout is groups; a group is `rounds` passes over its exercises; an exercise
 * contributes `sets` consecutive work steps per pass. That is `expandWorkout`'s rule
 * (backend/src/2_domains/fitness/workout/workout.mjs) and this screen is built so the
 * natural gesture produces the structure that rule wants:
 *
 *   - One exercise in a group is STRAIGHT SETS, so the group exposes a per-exercise
 *     "Sets" stepper and its `rounds` stays 1 -> A A A.
 *   - Two or more is a SUPERSET / CIRCUIT, so the group exposes a group-level "Rounds"
 *     stepper and every member's `sets` is pinned to 1 -> A B A B A B.
 *
 * Nobody is ever asked "sets or rounds?". Merging two 3-set singles into a superset
 * carries the 3 across as 3 rounds (see `mergeGroups`) and splitting it hands each
 * exercise its 3 sets back, so the number of times you actually do the movement
 * survives the gesture in both directions. `sets > 1` inside a multi-exercise group
 * stays legal in the domain — someone finishing both sets at a contested machine before
 * rotating — but it is not offered here: it is the one authoring that the group kind
 * label cannot describe, and this screen is used standing up.
 *
 * The kind itself is DERIVED from member count and only ever displayed. See
 * `groupKind` in GroupEditor.jsx.
 *
 * REORDERING IS BUTTONS, NOT DRAG
 * -------------------------------
 * Deliberate. This runs in a Firefox kiosk on a garage-gym TV, tapped with whole sweaty
 * fingers from arm's length. Drag needs an uninterrupted, tracked contact across a
 * distance — the exact gesture a damp finger on a warm panel drops halfway, and the one
 * that fights the page's own touch scrolling. Up/down targets are discrete (a slip is a
 * no-op, not a group dropped into the wrong position), idempotent, reachable from a
 * keyboard for free, and they need no drop-target hit-testing to stay correct while the
 * list is moving. A plan is a handful of groups, so "two taps" is the whole cost.
 *
 * WHAT RUN RECEIVES (and why Start is a round trip)
 * -------------------------------------------------
 * `onStartRun` is handed a FLAT, already-ordered step list fetched from the server, plus
 * the corpus display records the runner labels those steps with. Nothing is flattened
 * here: expansion belongs to `expandWorkout` in the domain module, which the frontend
 * cannot import (no alias resolves `backend/src`) and must not copy — a second
 * implementation is precisely the duplicated-ordering bug that module exists to prevent.
 * So Start POSTs the authored plan to `POST /workouts/run` and waits for the expansion.
 *
 * The DRAFT endpoint, not `GET /workouts/:id/run`: Start is its own target beside Save,
 * so the plan in hand normally has no id, and even after a save the person may have kept
 * editing. The plan they are about to perform is the one on this screen. Nothing is
 * persisted by starting a run.
 *
 * A failed round trip HOLDS on this screen with an error rather than moving to a runner
 * that would show its empty-plan screen — a blank run in the middle of a session is
 * worse than a Start button that says why it did not work and can be tapped again.
 *
 * INTERACTION
 * -----------
 * onPointerDown, not onClick — see the note at the top of FitnessApp.jsx. Enter/Space
 * are kept on every focusable target.
 */

/** Enter/Space keep every pointer target reachable from a keyboard. */
function activationKey(event) {
  return event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar';
}

/** A TV-sized tap target. onPointerDown fires; Enter/Space keep it keyboard-reachable. */
function TapTarget({ testId, label, sub = null, variant = 'primary', disabled = false, onActivate }) {
  const onKeyDown = useCallback((e) => {
    if (!activationKey(e)) return;
    e.preventDefault();
    if (!disabled) onActivate();
  }, [onActivate, disabled]);

  return (
    <div
      className={`workout-builder__tap workout-builder__tap--${variant}${disabled ? ' workout-builder__tap--off' : ''}`}
      data-testid={testId}
      data-disabled={disabled ? 'true' : 'false'}
      role="button"
      aria-disabled={disabled}
      tabIndex={0}
      onPointerDown={() => { if (!disabled) onActivate(); }}
      onKeyDown={onKeyDown}
    >
      <span className="workout-builder__tap-label">{label}</span>
      {sub && <span className="workout-builder__tap-sub">{sub}</span>}
    </div>
  );
}

TapTarget.propTypes = {
  testId: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  sub: PropTypes.string,
  variant: PropTypes.string,
  disabled: PropTypes.bool,
  onActivate: PropTypes.func.isRequired
};

export default function WorkoutBuilder({ exercises = [], onStartRun = null, onCancel = null }) {
  const logger = useMemo(() => getLogger().child({ component: 'workout-builder' }), []);

  // Seeded once, from the tray Browse handed over: one straight-sets group per pick, in
  // the order they were picked. Re-seeding on a prop identity change would throw away
  // edits every time the container re-renders.
  const [groups, setGroups] = useState(() =>
    (Array.isArray(exercises) ? exercises : []).filter((e) => e?.slug).map((e) => makeGroup(e))
  );
  const [title, setTitle] = useState(() => defaultWorkoutTitle());
  const [savedId, setSavedId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);
  // Start is a server round trip (expansion + corpus join), so it has the same
  // in-flight/failed states Save does.
  const [starting, setStarting] = useState(false);
  const [runError, setRunError] = useState(null);

  // Mirrors state for handlers that LOG the transition they make. Reading state inside a
  // setState updater is unsafe (React may invoke updaters twice), so handlers compute the
  // next value from the ref and set it directly.
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const titleRef = useRef(title);
  titleRef.current = title;
  const savedIdRef = useRef(savedId);
  savedIdRef.current = savedId;
  const savingRef = useRef(false);
  const startingRef = useRef(false);

  const onStartRunRef = useRef(onStartRun);
  onStartRunRef.current = onStartRun;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    logger.info('mounted', {
      tray: (Array.isArray(exercises) ? exercises : []).length
    });
    // Once only: the tray is a seed, not a live binding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logger]);

  /** Apply a groups transform, and log it only if something actually changed. */
  const applyGroups = useCallback((next, event, data) => {
    if (next === groupsRef.current) {
      logger.debug(`${event}-noop`, data);
      return false;
    }
    groupsRef.current = next;
    setGroups(next);
    // A structural edit invalidates the "saved" badge — the shelf copy is now stale.
    setSavedAt(null);
    logger.info(event, { ...data, groups: next.length });
    return true;
  }, [logger]);

  // Slugs currently placed. The tray shows the picks that are NOT in the plan, so
  // removing an exercise puts it back within reach instead of forcing a trip to Browse.
  const placed = useMemo(() => {
    const set = new Set();
    groups.forEach((g) => g.exercises.forEach((m) => set.add(m.slug)));
    return set;
  }, [groups]);

  const tray = useMemo(
    () => (Array.isArray(exercises) ? exercises : []).filter((e) => e?.slug && !placed.has(e.slug)),
    [exercises, placed]
  );

  const addExercise = useCallback((exercise) => {
    if (!exercise?.slug) return;
    applyGroups([...groupsRef.current, makeGroup(exercise)], 'exercise-add', { slug: exercise.slug });
  }, [applyGroups]);

  const removeGroup = useCallback((index) => {
    const current = groupsRef.current;
    const group = current[index];
    if (!group) return;
    applyGroups(current.filter((_, i) => i !== index), 'group-remove', {
      index,
      slugs: group.exercises.map((m) => m.slug)
    });
  }, [applyGroups]);

  const removeMember = useCallback((index, memberIndex) => {
    const current = groupsRef.current;
    const group = current[index];
    const member = group?.exercises[memberIndex];
    if (!member) return;
    const remaining = group.exercises.filter((_, i) => i !== memberIndex);
    // Emptying a group deletes it: an empty group expands to nothing and would sit on
    // screen as a slot the user has to tidy up by hand.
    const next = remaining.length === 0
      ? current.filter((_, i) => i !== index)
      : current.map((g, i) => (i === index
        // Back down to one exercise means back to straight sets, so the passes that were
        // living in `rounds` move into the survivor's `sets` — the same carry as a split.
        ? { ...g, rounds: 1, exercises: remaining.map((m) => (remaining.length === 1 ? { ...m, sets: effectivePasses(g) } : m)) }
        : g));
    applyGroups(next, 'exercise-remove', { index, memberIndex, slug: member.slug });
  }, [applyGroups]);

  const moveGroup = useCallback((index, delta) => {
    const current = groupsRef.current;
    applyGroups(moveItem(current, index, delta), 'group-reorder', {
      index, to: index + delta, direction: delta < 0 ? 'up' : 'down'
    });
  }, [applyGroups]);

  const moveMember = useCallback((index, memberIndex, delta) => {
    const current = groupsRef.current;
    const group = current[index];
    if (!group) return;
    const moved = moveItem(group.exercises, memberIndex, delta);
    const next = moved === group.exercises
      ? current
      : current.map((g, i) => (i === index ? { ...g, exercises: moved } : g));
    applyGroups(next, 'exercise-reorder', {
      index, memberIndex, to: memberIndex + delta, direction: delta < 0 ? 'up' : 'down'
    });
  }, [applyGroups]);

  const merge = useCallback((index) => {
    const current = groupsRef.current;
    const next = mergeGroups(current, index);
    applyGroups(next, 'group-merge', {
      index,
      kind: groupKind(next[index])
    });
  }, [applyGroups]);

  const split = useCallback((index) => {
    const current = groupsRef.current;
    applyGroups(splitGroup(current, index), 'group-split', {
      index, size: current[index]?.exercises.length ?? 0
    });
  }, [applyGroups]);

  const patchMember = useCallback((index, memberIndex, patch) => {
    const current = groupsRef.current;
    const group = current[index];
    if (!group?.exercises[memberIndex]) return;
    const next = current.map((g, i) => (i === index
      ? { ...g, exercises: g.exercises.map((m, j) => (j === memberIndex ? { ...m, ...patch } : m)) }
      : g));
    groupsRef.current = next;
    setGroups(next);
    setSavedAt(null);
    logger.debug('exercise-edit', { index, memberIndex, slug: group.exercises[memberIndex].slug, patch });
  }, [logger]);

  const patchRounds = useCallback((index, rounds) => {
    const current = groupsRef.current;
    if (!current[index]) return;
    const next = current.map((g, i) => (i === index ? { ...g, rounds } : g));
    groupsRef.current = next;
    setGroups(next);
    setSavedAt(null);
    logger.debug('group-edit', { index, rounds });
  }, [logger]);

  const save = useCallback(async () => {
    if (savingRef.current) return;
    const payload = toPayload({ id: savedIdRef.current, title: titleRef.current, groups: groupsRef.current });
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    logger.info('save-start', {
      id: payload.id ?? null,
      title: payload.title,
      groups: payload.groups.length,
      exercises: payload.groups.reduce((n, g) => n + g.exercises.length, 0)
    });
    try {
      const res = await DaylightAPI(WORKOUTS_PATH, payload, 'POST');
      const id = typeof res?.id === 'string' ? res.id : null;
      if (id) {
        setSavedId(id);
        savedIdRef.current = id;
      }
      setSavedAt(res?.updatedAt ?? new Date().toISOString());
      logger.info('save-success', { id, created: res?.created ?? null, groups: payload.groups.length });
    } catch (err) {
      const parsed = parseSaveError(err);
      setSaveError(parsed);
      logger.error('save-failed', {
        id: payload.id ?? null,
        error: parsed.message,
        unknownSlugs: parsed.unknownSlugs
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [logger]);

  const startRun = useCallback(async () => {
    if (startingRef.current) return;
    const current = groupsRef.current;
    const payload = toPayload({ id: savedIdRef.current, title: titleRef.current, groups: current });
    // The plan's own member rows, as the display fallback for a slug the corpus no longer
    // resolves. In plan order, deduped by `toDisplayList`.
    const members = [];
    current.forEach((g) => g.exercises.forEach((m) => members.push({
      slug: m.slug, name: m.name, image: m.image
    })));

    startingRef.current = true;
    setStarting(true);
    setRunError(null);
    logger.info('start-run-request', {
      id: payload.id ?? null,
      groups: payload.groups.length,
      workSteps: totalWorkSteps(current)
    });

    try {
      // The server expands and joins — see the round-trip note in the docblock.
      const res = await DaylightAPI(RUN_PATH, payload, 'POST');
      const steps = Array.isArray(res?.steps) ? res.steps : [];
      const missingSlugs = Array.isArray(res?.missingSlugs) ? res.missingSlugs : [];
      logger.info('start-run', {
        id: payload.id ?? null,
        groups: payload.groups.length,
        workSteps: totalWorkSteps(current),
        steps: steps.length,
        hasSteps: steps.length > 0,
        missingSlugs
      });
      onStartRunRef.current?.({
        ...payload,
        steps,
        exercises: toDisplayList(res?.exercises, members)
      });
    } catch (err) {
      // Hold here rather than moving to a runner with nothing in it.
      const parsed = parseSaveError(err);
      setRunError(parsed);
      logger.error('start-run-failed', { id: payload.id ?? null, error: parsed.message });
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }, [logger]);

  const cancel = useCallback(() => {
    logger.info('cancel-build', { groups: groupsRef.current.length, savedId: savedIdRef.current });
    onCancelRef.current?.();
  }, [logger]);

  const workSteps = totalWorkSteps(groups);
  const unknownSet = useMemo(
    () => new Set(saveError?.unknownSlugs ?? []),
    [saveError]
  );

  return (
    <div className="workout-builder" data-testid="workout-builder">
      <header className="workout-builder__header">
        <div className="workout-builder__heading">
          <label className="workout-builder__title-label" htmlFor="workout-builder-title">Workout</label>
          <input
            id="workout-builder-title"
            className="workout-builder__title"
            data-testid="workout-builder-title"
            type="text"
            value={title}
            aria-label="Workout title"
            onChange={(e) => setTitle(e.target.value)}
          />
          <span className="workout-builder__summary" data-testid="workout-builder-summary">
            {groups.length} {groups.length === 1 ? 'group' : 'groups'} · {workSteps} {workSteps === 1 ? 'set' : 'sets'}
          </span>
        </div>

        <TapTarget
          testId="workout-builder-save"
          label={saving ? 'Saving…' : 'Save'}
          sub={savedId ? 'Update' : 'To the shelf'}
          variant="ghost"
          disabled={saving || groups.length === 0}
          onActivate={save}
        />
        <TapTarget
          testId="fitness-instruction-to-run"
          label={starting ? 'Starting…' : 'Start workout'}
          sub={`${workSteps} ${workSteps === 1 ? 'set' : 'sets'}`}
          variant="primary"
          disabled={starting}
          onActivate={startRun}
        />
        <TapTarget
          testId="fitness-instruction-build-back"
          label="Back"
          variant="ghost"
          onActivate={cancel}
        />
      </header>

      {saveError && (
        <section className="workout-builder__notice workout-builder__notice--error" data-testid="workout-builder-error">
          <div className="workout-builder__notice-title">
            {saveError.unknownSlugs.length > 0 ? 'These exercises are not in the library' : 'Could not save'}
          </div>
          {saveError.unknownSlugs.length > 0 ? (
            <ul className="workout-builder__unknown" data-testid="workout-builder-unknown">
              {saveError.unknownSlugs.map((slug) => (
                <li key={slug} data-testid={`workout-builder-unknown-${slug}`}>{slug}</li>
              ))}
            </ul>
          ) : (
            <p className="workout-builder__notice-body">{saveError.message}</p>
          )}
        </section>
      )}

      {runError && (
        <section className="workout-builder__notice workout-builder__notice--error" data-testid="workout-builder-run-error">
          <div className="workout-builder__notice-title">Could not start the workout</div>
          <p className="workout-builder__notice-body">{runError.message}</p>
        </section>
      )}

      {savedAt && !saveError && (
        <section className="workout-builder__notice workout-builder__notice--ok" data-testid="workout-builder-saved">
          <div className="workout-builder__notice-title">Saved</div>
          <p className="workout-builder__notice-body">{savedId}</p>
        </section>
      )}

      {tray.length > 0 && (
        <section className="workout-builder__tray" data-testid="workout-builder-tray" aria-label="Picked exercises">
          <span className="workout-builder__tray-label">Not in the plan</span>
          <div className="workout-builder__tray-items">
            {tray.map((exercise) => (
              <TapTarget
                key={exercise.slug}
                testId={`workout-builder-tray-add-${exercise.slug}`}
                label={exercise.name || exercise.slug}
                sub="Add"
                variant="ghost"
                onActivate={() => addExercise(exercise)}
              />
            ))}
          </div>
        </section>
      )}

      {groups.length === 0 ? (
        <section className="workout-builder__notice" data-testid="workout-builder-empty">
          <div className="workout-builder__notice-title">Nothing in this workout yet</div>
          <p className="workout-builder__notice-body">
            Go back to Browse and pick some exercises.
          </p>
        </section>
      ) : (
        <div className="workout-builder__groups" data-testid="workout-builder-groups">
          {groups.map((group, index) => (
            <GroupEditor
              key={group.key}
              group={group}
              index={index}
              total={groups.length}
              unknownSlugs={unknownSet}
              onMoveGroup={moveGroup}
              onRemoveGroup={removeGroup}
              onMerge={merge}
              onSplit={split}
              onRounds={patchRounds}
              onMoveMember={moveMember}
              onRemoveMember={removeMember}
              onPatchMember={patchMember}
            />
          ))}
        </div>
      )}
    </div>
  );
}

WorkoutBuilder.propTypes = {
  /** Corpus records from the Browse tray: { slug, name, image }. Seed only. */
  exercises: PropTypes.arrayOf(PropTypes.object),
  /** Hands the authored plan to the container's `startRun`. */
  onStartRun: PropTypes.func,
  /** Backs out to Browse, discarding the draft (the container's `cancelBuild`). */
  onCancel: PropTypes.func
};
