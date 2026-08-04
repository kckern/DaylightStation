import {
  Ti86SchoolCalcCodec,
  decodeTi86InteractionRequest,
  decodeTi86InteractionResponse,
  encodeTi86InteractionRequest,
} from '../../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import {
  SCHOOLCALC_LOCAL_STATE_SLOTS,
  prepareSchoolCalcLocalStateSave,
  selectSchoolCalcLocalState,
} from './schoolcalc-local-state.mjs';

export const TI86_INTERACTION_VARIABLES = Object.freeze({
  identity: 'DSID',
  request: 'DSTREQ',
  stage: 'DSTNEW',
  canonical: 'DSTURN',
});

export class Ti86InteractionMutationInterrupted extends Error {
  constructor({ mutation, label }) {
    super(`simulated power loss after interaction mutation ${mutation} (${label})`);
    this.name = 'Ti86InteractionMutationInterrupted';
    this.code = 'TI86_INTERACTION_MUTATION_INTERRUPTED';
    this.mutation = mutation;
    this.label = label;
  }
}

/**
 * Persist one logical SCTQ before committing the sync continuation.
 *
 * Re-entry accepts only the exact retained request. If power failed between
 * the two writes, its request ID repairs nextRequestId exactly once.
 */
export function commitTi86InteractionRequest(
  variables,
  rawRequest,
  { interruptAfterMutation = null } = {},
) {
  requireVariables(variables);
  const scope = selectedScope(variables);
  const bytes = encodeTi86InteractionRequest(rawRequest);
  const request = requireScopedRequest(bytes, scope);
  const retained = variables.get(TI86_INTERACTION_VARIABLES.request);
  if (retained != null) {
    const existing = requireScopedRequest(retained, scope);
    if (!Buffer.from(retained).equals(bytes)) {
      throw new Error('DSTREQ already contains another logical interaction');
    }
    return repairRequestContinuation(variables, existing, { interruptAfterMutation });
  }
  if (request.requestId !== scope.selection.state.nextRequestId) {
    throw new Error('SCTQ requestId must equal the durable nextRequestId');
  }
  if (request.requestId === 0xff_ffff) throw new Error('SCTQ requestId space is exhausted');
  const mutations = mutationHarness(interruptAfterMutation);
  mutations.apply(`write:${TI86_INTERACTION_VARIABLES.request}`, () => {
    variables.set(TI86_INTERACTION_VARIABLES.request, Buffer.from(bytes));
  });
  writeRequestContinuation(variables, scope.selection, request.requestId + 1, mutations);
  return Object.freeze({
    status: 'committed', request, mutationCount: mutations.count(), trace: mutations.trace(),
  });
}

/** Repair the request-counter cut after DSTREQ creation without duplicating a turn. */
export function reconcileTi86InteractionRequest(
  variables,
  { interruptAfterMutation = null } = {},
) {
  requireVariables(variables);
  const scope = selectedScope(variables);
  const bytes = variables.get(TI86_INTERACTION_VARIABLES.request);
  if (bytes == null) return Object.freeze({ status: 'idle', mutationCount: 0, trace: Object.freeze([]) });
  const request = requireScopedRequest(bytes, scope);
  return repairRequestContinuation(variables, request, { interruptAfterMutation });
}

/**
 * Promote a complete SCTR with copy-on-write recovery and exact SCTQ binding.
 * The staged copy is deleted last. A cut after acknowledged-request deletion
 * converges by matching the retained stage to the already-valid canonical.
 */
export function promoteTi86InteractionResponse(
  variables,
  { interruptAfterMutation = null } = {},
) {
  requireVariables(variables);
  const scope = selectedScope(variables);
  const stagedBytes = variables.get(TI86_INTERACTION_VARIABLES.stage);
  if (stagedBytes == null) {
    return Object.freeze({
      promoted: false,
      response: optionalScopedResponse(
        variables.get(TI86_INTERACTION_VARIABLES.canonical), scope,
      ),
      mutationCount: 0,
      trace: Object.freeze([]),
    });
  }
  const staged = requireScopedResponse(stagedBytes, scope);
  const requestBytes = variables.get(TI86_INTERACTION_VARIABLES.request);
  if (requestBytes != null) {
    const request = requireScopedRequest(requestBytes, scope);
    requireSameRequest(staged, request);
  } else {
    const canonical = requireScopedResponse(
      variables.get(TI86_INTERACTION_VARIABLES.canonical), scope,
    );
    if (canonical.requestId !== staged.requestId) {
      throw new Error('orphan DSTNEW does not match the committed DSTURN');
    }
  }

  const exact = Buffer.from(stagedBytes);
  const mutations = mutationHarness(interruptAfterMutation);
  if (variables.has(TI86_INTERACTION_VARIABLES.canonical)) {
    mutations.apply(`delete:${TI86_INTERACTION_VARIABLES.canonical}`, () => {
      variables.delete(TI86_INTERACTION_VARIABLES.canonical);
    });
  }
  mutations.apply(`write:${TI86_INTERACTION_VARIABLES.canonical}`, () => {
    variables.set(TI86_INTERACTION_VARIABLES.canonical, Buffer.from(exact));
  });
  const committed = requireScopedResponse(
    variables.get(TI86_INTERACTION_VARIABLES.canonical), scope,
  );
  if (committed.requestId !== staged.requestId) {
    throw new Error('DSTURN verification changed the staged request identity');
  }
  if (committed.acknowledgeRequest && variables.has(TI86_INTERACTION_VARIABLES.request)) {
    mutations.apply(`delete:${TI86_INTERACTION_VARIABLES.request}`, () => {
      variables.delete(TI86_INTERACTION_VARIABLES.request);
    });
  }
  mutations.apply(`delete:${TI86_INTERACTION_VARIABLES.stage}`, () => {
    variables.delete(TI86_INTERACTION_VARIABLES.stage);
  });
  return Object.freeze({
    promoted: true,
    response: committed,
    mutationCount: mutations.count(),
    trace: mutations.trace(),
  });
}

export function inspectTi86InteractionState(variables) {
  requireVariables(variables);
  const scope = selectedScope(variables);
  const request = optionalScopedRequest(
    variables.get(TI86_INTERACTION_VARIABLES.request), scope,
  );
  const response = optionalScopedResponse(
    variables.get(TI86_INTERACTION_VARIABLES.canonical), scope,
  );
  return Object.freeze({
    status: response ? 'response_ready' : request ? 'request_pending' : 'idle',
    deviceId: scope.deviceId,
    learnerKey: scope.learnerKey,
    request,
    response,
    selection: scope.selection,
  });
}

function repairRequestContinuation(variables, request, { interruptAfterMutation }) {
  const selection = selectLocal(variables);
  const next = selection.state.nextRequestId;
  if (next === request.requestId + 1) {
    return Object.freeze({
      status: 'retained', request, mutationCount: 0, trace: Object.freeze([]),
    });
  }
  if (request.requestId === 0xff_ffff || next !== request.requestId) {
    throw new Error('DSTREQ and SCL1 request counters diverge');
  }
  const mutations = mutationHarness(interruptAfterMutation);
  writeRequestContinuation(variables, selection, request.requestId + 1, mutations);
  return Object.freeze({
    status: 'repaired', request, mutationCount: mutations.count(), trace: mutations.trace(),
  });
}

function writeRequestContinuation(variables, selection, nextRequestId, mutations) {
  const save = prepareSchoolCalcLocalStateSave(selection, { nextRequestId, view: 'sync' });
  mutations.apply(`write:${save.targetSlot}`, () => {
    variables.set(save.targetSlot, Buffer.from(save.bytes));
  });
}

function selectedScope(variables) {
  const identity = variables.get(TI86_INTERACTION_VARIABLES.identity);
  if (identity == null) throw new Error('required TI-86 variable DSID is missing');
  const deviceId = new Ti86SchoolCalcCodec().decodeDeviceIdentity(identity).deviceId;
  const selection = selectLocal(variables);
  const learnerKey = selection.state.selectedLearnerKey;
  if (!Number.isInteger(learnerKey) || learnerKey < 1) {
    throw new Error('connected interaction requires a selected learner');
  }
  return Object.freeze({ deviceId, learnerKey, selection });
}

function requireScopedRequest(bytes, scope) {
  if (bytes == null) throw new Error('required DSTREQ is missing');
  const request = decodeTi86InteractionRequest(bytes);
  if (request.deviceId !== scope.deviceId || request.learnerKey !== scope.learnerKey) {
    throw new Error('SCTQ does not belong to the selected calculator learner');
  }
  return request;
}

function optionalScopedRequest(bytes, scope) {
  return bytes == null ? null : requireScopedRequest(bytes, scope);
}

function requireScopedResponse(bytes, scope) {
  if (bytes == null) throw new Error('required SCTR is missing');
  const response = decodeTi86InteractionResponse(bytes);
  if (response.deviceId !== scope.deviceId || response.learnerKey !== scope.learnerKey) {
    throw new Error('SCTR does not belong to the selected calculator learner');
  }
  return response;
}

function optionalScopedResponse(bytes, scope) {
  return bytes == null ? null : requireScopedResponse(bytes, scope);
}

function requireSameRequest(response, request) {
  if (response.deviceId !== request.deviceId
      || response.learnerKey !== request.learnerKey
      || response.requestId !== request.requestId) {
    throw new Error('SCTR does not answer the exact durable SCTQ request');
  }
}

function selectLocal(variables) {
  return selectSchoolCalcLocalState(Object.fromEntries(
    SCHOOLCALC_LOCAL_STATE_SLOTS.map((name) => [name, variables.get(name) ?? null]),
  ));
}

function mutationHarness(interruptAfterMutation) {
  if (interruptAfterMutation !== null
      && (!Number.isInteger(interruptAfterMutation) || interruptAfterMutation < 1)) {
    throw new Error('interruptAfterMutation must be a positive integer');
  }
  let mutationCount = 0;
  const entries = [];
  return Object.freeze({
    apply(label, operation) {
      operation();
      mutationCount += 1;
      entries.push(label);
      if (mutationCount === interruptAfterMutation) {
        throw new Ti86InteractionMutationInterrupted({ mutation: mutationCount, label });
      }
    },
    count: () => mutationCount,
    trace: () => Object.freeze([...entries]),
  });
}

function requireVariables(variables) {
  if (!(variables instanceof Map)) throw new Error('TI-86 interaction variables must be a Map');
}

export default promoteTi86InteractionResponse;
