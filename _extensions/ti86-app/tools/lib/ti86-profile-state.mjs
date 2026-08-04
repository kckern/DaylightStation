import {
  Ti86SchoolCalcCodec,
  decodeTi86LearnerRoster,
  decodeTi86ProgressProjection,
} from '../../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import {
  SCHOOLCALC_LOCAL_FLAGS,
  SCHOOLCALC_LOCAL_STATE_SLOTS,
  prepareSchoolCalcLocalStateSave,
  selectSchoolCalcLocalState,
} from './schoolcalc-local-state.mjs';

export const TI86_PROFILE_VARIABLES = Object.freeze({
  identity: 'DSID',
  stage: 'DSUSRNEW',
  canonical: 'DSUSERS',
  progressStage: 'DSPRGNEW',
  progressCanonical: 'DSPROG',
});

export class Ti86ProfileMutationInterrupted extends Error {
  constructor({ mutation, label }) {
    super(`simulated power loss after profile mutation ${mutation} (${label})`);
    this.name = 'Ti86ProfileMutationInterrupted';
    this.code = 'TI86_PROFILE_MUTATION_INTERRUPTED';
    this.mutation = mutation;
    this.label = label;
  }
}

/**
 * Promote a complete SCU1 staging record without risking the prior roster.
 *
 * The stage is validated and device-bound before mutation. It remains the
 * recovery source until the replacement canonical record validates, and is
 * deleted last. Re-entry after any cut therefore converges idempotently.
 */
export function promoteTi86LearnerRoster(variables, { interruptAfterMutation = null } = {}) {
  requireVariableMap(variables);
  if (interruptAfterMutation !== null
      && (!Number.isInteger(interruptAfterMutation) || interruptAfterMutation < 1)) {
    throw new Error('interruptAfterMutation must be a positive integer');
  }
  const deviceId = decodeIdentity(variables);
  const stage = variables.get(TI86_PROFILE_VARIABLES.stage);
  if (stage == null) {
    const roster = optionalRoster(variables.get(TI86_PROFILE_VARIABLES.canonical), deviceId);
    return Object.freeze({ promoted: false, mutationCount: 0, roster, trace: Object.freeze([]) });
  }
  const roster = requireRoster(stage, deviceId);
  const exact = Buffer.from(stage);
  const trace = [];
  let mutationCount = 0;
  const mutate = (label, operation) => {
    operation();
    mutationCount += 1;
    trace.push(label);
    if (mutationCount === interruptAfterMutation) {
      throw new Ti86ProfileMutationInterrupted({ mutation: mutationCount, label });
    }
  };
  if (variables.has(TI86_PROFILE_VARIABLES.canonical)) {
    mutate(`delete:${TI86_PROFILE_VARIABLES.canonical}`, () => {
      variables.delete(TI86_PROFILE_VARIABLES.canonical);
    });
  }
  mutate(`write:${TI86_PROFILE_VARIABLES.canonical}`, () => {
    variables.set(TI86_PROFILE_VARIABLES.canonical, Buffer.from(exact));
  });
  requireRoster(variables.get(TI86_PROFILE_VARIABLES.canonical), deviceId);
  mutate(`delete:${TI86_PROFILE_VARIABLES.stage}`, () => {
    variables.delete(TI86_PROFILE_VARIABLES.stage);
  });
  return Object.freeze({
    promoted: true,
    mutationCount,
    roster,
    trace: Object.freeze(trace),
  });
}

/** Promote a complete, device-bound SCG1 projection with the same cut safety. */
export function promoteTi86ProgressProjection(variables, { interruptAfterMutation = null } = {}) {
  requireVariableMap(variables);
  if (interruptAfterMutation !== null
      && (!Number.isInteger(interruptAfterMutation) || interruptAfterMutation < 1)) {
    throw new Error('interruptAfterMutation must be a positive integer');
  }
  const deviceId = decodeIdentity(variables);
  const stage = variables.get(TI86_PROFILE_VARIABLES.progressStage);
  if (stage == null) {
    const progress = optionalProgress(
      variables.get(TI86_PROFILE_VARIABLES.progressCanonical), deviceId,
    );
    return Object.freeze({ promoted: false, mutationCount: 0, progress, trace: Object.freeze([]) });
  }
  const progress = requireProgress(stage, deviceId);
  const exact = Buffer.from(stage);
  const trace = [];
  let mutationCount = 0;
  const mutate = (label, operation) => {
    operation();
    mutationCount += 1;
    trace.push(label);
    if (mutationCount === interruptAfterMutation) {
      throw new Ti86ProfileMutationInterrupted({ mutation: mutationCount, label });
    }
  };
  if (variables.has(TI86_PROFILE_VARIABLES.progressCanonical)) {
    mutate(`delete:${TI86_PROFILE_VARIABLES.progressCanonical}`, () => {
      variables.delete(TI86_PROFILE_VARIABLES.progressCanonical);
    });
  }
  mutate(`write:${TI86_PROFILE_VARIABLES.progressCanonical}`, () => {
    variables.set(TI86_PROFILE_VARIABLES.progressCanonical, Buffer.from(exact));
  });
  requireProgress(variables.get(TI86_PROFILE_VARIABLES.progressCanonical), deviceId);
  mutate(`delete:${TI86_PROFILE_VARIABLES.progressStage}`, () => {
    variables.delete(TI86_PROFILE_VARIABLES.progressStage);
  });
  return Object.freeze({
    promoted: true, mutationCount, progress, trace: Object.freeze(trace),
  });
}

/** Resolve the remembered soft profile to its offline progress snapshot. */
export function getTi86SelectedProgress(variables) {
  requireVariableMap(variables);
  const deviceId = decodeIdentity(variables);
  const selection = selectLocal(variables);
  const learnerKey = selection.state.selectedLearnerKey;
  if (learnerKey === 0) {
    return Object.freeze({ status: 'guest', learnerKey, progress: null, selection });
  }
  const projection = optionalProgress(
    variables.get(TI86_PROFILE_VARIABLES.progressCanonical), deviceId,
  );
  if (!projection) {
    return Object.freeze({ status: 'unavailable', learnerKey, progress: null, selection });
  }
  const progress = projection.profiles.find((profile) => profile.learnerKey === learnerKey) ?? null;
  return Object.freeze({
    status: progress ? 'available' : 'unavailable', learnerKey,
    progress: progress ? structuredClone(progress) : null,
    selection,
  });
}

/** List active configured profiles and the synthetic, nonpersistent Guest. */
export function listTi86LearnerChoices(variables) {
  requireVariableMap(variables);
  const deviceId = decodeIdentity(variables);
  const roster = optionalRoster(variables.get(TI86_PROFILE_VARIABLES.canonical), deviceId);
  return Object.freeze([
    ...(roster?.profiles ?? []).map((profile) => Object.freeze({ ...profile, persistent: true })),
    Object.freeze({ learnerKey: 0, label: 'Guest', persistent: false }),
  ]);
}

/**
 * Persist one explicit soft profile claim. Switching while a session is active
 * is rejected; the caller can finish/cancel the session and retry.
 */
export function selectTi86Learner(variables, { learnerKey } = {}) {
  requireVariableMap(variables);
  if (!Number.isInteger(learnerKey) || learnerKey < 0 || learnerKey > 0xffff) {
    throw new Error('TI-86 learner selection key is invalid');
  }
  const choices = listTi86LearnerChoices(variables);
  if (!choices.some((profile) => profile.learnerKey === learnerKey)) {
    throw new Error(`TI-86 learner key ${learnerKey} is not active on this calculator`);
  }
  const selection = selectLocal(variables);
  if (selection.state.selectedLearnerKey === learnerKey) {
    if (selection.state.flags & SCHOOLCALC_LOCAL_FLAGS.learnerSelected) {
      return Object.freeze({ status: 'unchanged', learnerKey, selection });
    }
    // An older/torn first-boot state may already carry the displayed key but
    // not the acknowledgement. Confirming the same choice is always safe,
    // including during a session, because attribution does not change.
    const saved = prepareSchoolCalcLocalStateSave(selection, {
      flags: selection.state.flags | SCHOOLCALC_LOCAL_FLAGS.learnerSelected,
    });
    variables.set(saved.targetSlot, Buffer.from(saved.bytes));
    return Object.freeze({ status: 'unchanged', learnerKey, selection: selectLocal(variables) });
  }
  if (selection.state.flags & SCHOOLCALC_LOCAL_FLAGS.sessionActive) {
    return Object.freeze({
      status: 'locked',
      learnerKey: selection.state.selectedLearnerKey,
      sessionLearnerKey: selection.state.sessionLearnerKey,
      selection,
    });
  }
  const saved = prepareSchoolCalcLocalStateSave(selection, {
    selectedLearnerKey: learnerKey,
    flags: selection.state.flags | SCHOOLCALC_LOCAL_FLAGS.learnerSelected,
  });
  variables.set(saved.targetSlot, Buffer.from(saved.bytes));
  return Object.freeze({ status: 'selected', learnerKey, selection: selectLocal(variables) });
}

/** Fall back a retired selection to Guest only after its active session ends. */
export function reconcileTi86LearnerSelection(variables) {
  requireVariableMap(variables);
  const selection = selectLocal(variables);
  const key = selection.state.selectedLearnerKey;
  if (key === 0) return Object.freeze({ status: 'guest', selection });
  if (selection.state.flags & SCHOOLCALC_LOCAL_FLAGS.sessionActive) {
    return Object.freeze({ status: 'locked', selection });
  }
  const choices = listTi86LearnerChoices(variables);
  if (choices.some((profile) => profile.learnerKey === key)) {
    return Object.freeze({ status: 'active', selection });
  }
  return selectTi86Learner(variables, { learnerKey: 0 });
}

function decodeIdentity(variables) {
  const record = variables.get(TI86_PROFILE_VARIABLES.identity);
  if (record == null) throw new Error('required TI-86 variable DSID is missing');
  return new Ti86SchoolCalcCodec().decodeDeviceIdentity(record).deviceId;
}

function optionalRoster(record, deviceId) {
  return record == null ? null : requireRoster(record, deviceId);
}

function optionalProgress(record, deviceId) {
  return record == null ? null : requireProgress(record, deviceId);
}

function requireProgress(record, deviceId) {
  const progress = decodeTi86ProgressProjection(record);
  if (progress.deviceId !== deviceId) throw new Error('SCG1 belongs to another calculator identity');
  return progress;
}

function requireRoster(record, deviceId) {
  const roster = decodeTi86LearnerRoster(record);
  if (roster.deviceId !== deviceId) throw new Error('SCU1 belongs to another calculator identity');
  return roster;
}

function selectLocal(variables) {
  return selectSchoolCalcLocalState(Object.fromEntries(
    SCHOOLCALC_LOCAL_STATE_SLOTS.map((name) => [name, variables.get(name) ?? null]),
  ));
}

function requireVariableMap(variables) {
  if (!(variables instanceof Map)) throw new Error('TI-86 profile variables must be a Map');
}

export default promoteTi86LearnerRoster;
