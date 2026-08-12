import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import getLogger from '@/lib/logging/Logger.js';
import { DaylightAPI } from '@/lib/api.mjs';
import GroupEditor, { groupKind } from './GroupEditor.jsx';
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
 * WHAT RUN RECEIVES (the loose end)
 * ---------------------------------
 * `onStartRun` is handed the authored plan plus the corpus display records — NOT a
 * flat step list. Expansion belongs to the domain module, which the frontend cannot
 * import (no alias resolves `backend/src`, and a second copy is precisely the
 * duplicated-ordering bug that module exists to prevent), and no endpoint expands a
 * workout yet. WorkoutRunner already flagged this: until the run path supplies `steps`,
 * Run renders its empty-plan screen. That stays a missing SERVER route, not a
 * re-implementation here.
 *
 * INTERACTION
 * -----------
 * onPointerDown, not onClick — see the note at the top of FitnessApp.jsx. Enter/Space
 * are kept on every focusable target.
 */

export const WORKOUTS_PATH = 'api/v1/fitness/workouts';

/** Authoring defaults. Straight sets of 10 with a minute's rest is the common case. */
export const DEFAULT_SETS = 3;
export const DEFAULT_REPS = 10;
export const DEFAULT_SECONDS = 30;
export const DEFAULT_REST = 60;

let keySeed = 0;
/** Stable React/reorder identity. Slugs cannot serve: a plan may repeat an exercise. */
function nextKey(prefix) {
  keySeed += 1;
  return `${prefix}${keySeed}`;
}

/** "Workout · Aug 11" — a saveable title with nothing typed. The kiosk has no keyboard. */
export function defaultWorkoutTitle(date = new Date()) {
  const month = date.toLocaleString('en-US', { month: 'short' });
  return `Workout · ${month} ${date.getDate()}`;
}

/** Clamp to a whole number inside [min, max]. */
export function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** One authored exercise row, seeded from a corpus record. */
export function makeMember(exercise = {}) {
  return {
    key: nextKey('m'),
    slug: typeof exercise.slug === 'string' ? exercise.slug.trim() : '',
    name: typeof exercise.name === 'string' && exercise.name.trim() ? exercise.name.trim() : null,
    image: typeof exercise.image === 'string' && exercise.image.trim() ? exercise.image.trim() : null,
    sets: DEFAULT_SETS,
    mode: 'reps', // 'reps' | 'time'
    reps: DEFAULT_REPS,
    seconds: DEFAULT_SECONDS,
    loadLb: 0,
    restSeconds: DEFAULT_REST
  };
}

/** A new straight-sets group holding one exercise. */
export function makeGroup(exercise) {
  return { key: nextKey('g'), rounds: 1, exercises: [makeMember(exercise)] };
}

/**
 * How many times this group is passed through, whichever knob is currently showing.
 *
 * A single-exercise group counts its passes in the member's `sets` (rounds is pinned at
 * 1); a multi-exercise group counts them in `rounds` (member sets are pinned at 1).
 * Merge and split both read this so the work survives the gesture.
 */
export function effectivePasses(group) {
  const members = Array.isArray(group?.exercises) ? group.exercises : [];
  if (members.length === 1) return clamp(members[0]?.sets ?? 1, 1, 99);
  return clamp(group?.rounds ?? 1, 1, 99);
}

/**
 * Fold group `index + 1` into group `index`.
 *
 * The merged group is a superset/circuit, so every member drops to `sets: 1` and the
 * passes move to `rounds` — the authoring `expandWorkout`'s docblock asks for, and the
 * only one that alternates (A B A B) rather than blocking (A A B B). Passes are the
 * larger of the two groups' so nothing silently loses work.
 */
export function mergeGroups(groups, index) {
  const list = Array.isArray(groups) ? groups : [];
  const a = list[index];
  const b = list[index + 1];
  if (!a || !b) return list;
  const merged = {
    key: a.key,
    rounds: Math.max(effectivePasses(a), effectivePasses(b)),
    exercises: [...a.exercises, ...b.exercises].map((m) => ({ ...m, sets: 1 }))
  };
  return [...list.slice(0, index), merged, ...list.slice(index + 2)];
}

/**
 * Break a group into one straight-sets group per exercise, each keeping the work it was
 * doing: the group's rounds become each member's sets. Inverse of `mergeGroups`.
 */
export function splitGroup(groups, index) {
  const list = Array.isArray(groups) ? groups : [];
  const group = list[index];
  if (!group || group.exercises.length < 2) return list;
  const passes = effectivePasses(group);
  const singles = group.exercises.map((m, i) => ({
    key: i === 0 ? group.key : nextKey('g'),
    rounds: 1,
    exercises: [{ ...m, sets: passes }]
  }));
  return [...list.slice(0, index), ...singles, ...list.slice(index + 1)];
}

/**
 * Move one item by `delta`. Out-of-range is a no-op returning the SAME array — the
 * caller uses identity to tell "nothing moved" from "moved", so an up-tap on the first
 * group neither reorders nor logs a reorder that did not happen.
 */
export function moveItem(list, index, delta) {
  const arr = Array.isArray(list) ? list : [];
  const to = index + delta;
  if (index < 0 || index >= arr.length || to < 0 || to >= arr.length) return arr;
  const next = [...arr];
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item);
  return next;
}

/** "135 lb" for display and for the domain's `load` text; 0 means unloaded. */
export function loadLabel(loadLb) {
  const n = Number(loadLb);
  return Number.isFinite(n) && n > 0 ? `${Math.round(n)} lb` : null;
}

/**
 * The wire shape: exactly the domain's Workout / ExerciseGroup / WorkoutExercise, with
 * the editor's presentation state (keys, display names, the unused half of the
 * reps/seconds toggle) dropped. An entry is counted or timed, never both — the domain
 * resolves a record carrying both to reps, so sending both would silently discard the
 * timed intent the user set.
 */
export function toPayload({ id = null, title = null, groups = [] } = {}) {
  const payload = {
    title: typeof title === 'string' && title.trim() ? title.trim() : null,
    groups: (Array.isArray(groups) ? groups : []).map((group) => ({
      rounds: clamp(group.rounds, 1, 99),
      exercises: (group.exercises || []).map((m) => ({
        slug: m.slug,
        sets: clamp(m.sets, 0, 99),
        reps: m.mode === 'reps' ? clamp(m.reps, 1, 999) : null,
        seconds: m.mode === 'time' ? clamp(m.seconds, 1, 3600) : null,
        load: loadLabel(m.loadLb),
        restSeconds: clamp(m.restSeconds, 0, 3600)
      }))
    }))
  };
  if (id) payload.id = id;
  return payload;
}

/**
 * Work steps the plan expands to.
 *
 * `expandWorkout` traverses a group `rounds` times and each exercise contributes `sets`
 * steps per traversal, so this is `rounds * Σ sets` per group — the same arithmetic, not
 * a UI-flavoured approximation of it. Rest steps are not counted: this is the "how much
 * work is this" number on the header, and rest is not work.
 */
export function totalWorkSteps(groups = []) {
  return (Array.isArray(groups) ? groups : []).reduce((sum, g) => {
    const perPass = (g.exercises || []).reduce((s, m) => s + clamp(m.sets, 0, 99), 0);
    return sum + clamp(g.rounds, 1, 99) * perPass;
  }, 0);
}

/**
 * Pull the server's rejection out of whatever DaylightAPI threw.
 *
 * `DaylightAPI` does not surface the parsed body — it throws
 * `HTTP 400: Bad Request - {"error":"…","unknownSlugs":["…"]}`, the JSON stringified onto
 * the end of a message. The 400 that matters here NAMES the exercises that do not exist,
 * and showing "HTTP 400: Bad Request" instead of those names would send someone hunting
 * through a plan they cannot see the fault in. So the tail is parsed back out; a message
 * with no JSON tail (a 503, a network drop) degrades to the raw text and no slug list.
 */
export function parseSaveError(err) {
  const message = err?.message ?? String(err ?? 'save failed');
  const start = message.indexOf('{');
  if (start !== -1) {
    try {
      const body = JSON.parse(message.slice(start));
      const slugs = Array.isArray(body?.unknownSlugs) ? body.unknownSlugs.filter(Boolean) : [];
      return {
        message: typeof body?.error === 'string' && body.error ? body.error : message,
        unknownSlugs: slugs,
        issues: Array.isArray(body?.issues) ? body.issues : []
      };
    } catch (_) { /* not a JSON tail — fall through to the raw message */ }
  }
  return { message, unknownSlugs: [], issues: [] };
}

/** Enter/Space keep every pointer target reachable from a keyboard. */
function activationKey(event) {
  return event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar';
}

/** A TV-sized tap target. onPointerDown fires; Enter/Space keep it keyboard-reachable. */
export function TapTarget({ testId, label, sub = null, variant = 'primary', disabled = false, onActivate }) {
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

  const startRun = useCallback(() => {
    const current = groupsRef.current;
    const payload = toPayload({ id: savedIdRef.current, title: titleRef.current, groups: current });
    // Display records for the runner's slug -> { name, image } lookup, in plan order.
    const display = [];
    const seen = new Set();
    current.forEach((g) => g.exercises.forEach((m) => {
      if (seen.has(m.slug)) return;
      seen.add(m.slug);
      display.push({ slug: m.slug, name: m.name, image: m.image });
    }));
    logger.info('start-run', {
      id: payload.id ?? null,
      groups: payload.groups.length,
      workSteps: totalWorkSteps(current),
      // No expansion endpoint yet — Run will show its empty-plan screen. Logged so the
      // gap is visible in the field rather than looking like a builder bug.
      hasSteps: false
    });
    onStartRunRef.current?.({ ...payload, exercises: display });
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
          label="Start workout"
          sub={`${workSteps} ${workSteps === 1 ? 'set' : 'sets'}`}
          variant="primary"
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
