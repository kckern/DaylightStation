import { describe, expect, it } from 'vitest';
import {
  Ti86SchoolCalcCodec,
  decodeTi86InteractionRequest,
} from '../../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import { encodeSchoolCalcLocalState } from './schoolcalc-local-state.mjs';
import {
  TI86_INTERACTION_VARIABLES,
  Ti86InteractionMutationInterrupted,
  commitTi86InteractionRequest,
  inspectTi86InteractionState,
  promoteTi86InteractionResponse,
  reconcileTi86InteractionRequest,
} from './ti86-interaction-state.mjs';

const codec = new Ti86SchoolCalcCodec();
const deviceId = '86A001';
const learnerKey = 41;

function variables() {
  return new Map([
    [TI86_INTERACTION_VARIABLES.identity, codec.encodeDeviceIdentity({ deviceId })],
    ['DSLOCAL0', encodeSchoolCalcLocalState({
      generation: 4, selectedLearnerKey: learnerKey, nextRequestId: 17,
    })],
  ]);
}

function invokeRequest(requestId = 17) {
  return {
    schema: 'school.calc.interaction-request/v1', deviceId, learnerKey, requestId,
    action: 'invoke_follow_up', clientSequence: 0, lastServerSequence: 0,
    actionKey: 'ABCDEFG234',
  };
}

function response(status = 'complete') {
  const complete = status === 'complete';
  return codec.encodeInteractionResponse({
    schema: 'school.calc.interaction-response/v1', deviceId, learnerKey, requestId: 17,
    status,
    acknowledgeRequest: complete,
    retryable: !complete,
    message: complete ? 'Let us work through this.' : 'Still working; retry safely.',
    ...(complete ? {
      session: {
        sessionId: 'rem-17', status: 'active', masteryPercent: 44, targetPercent: 80,
        learnerControls: ['stop', 'skip', 'explain', 'challenge'],
        cursor: { nextClientSequence: 1, latestServerSequence: 1 },
        currentTurnId: 'turn-1',
        turns: [{
          turnId: 'turn-1', serverSequence: 1, body: 'Consider the first step.',
          prompt: 'Which operation preserves equality?',
          choices: [
            { id: 'A', label: 'Add both sides' },
            { id: 'B', label: 'Change one side' },
          ],
        }],
      },
    } : {}),
  });
}

describe('TI-86 durable interaction state', () => {
  it('writes SCTQ before the alternating sync continuation and repairs a cut between them', () => {
    const state = variables();
    expect(() => commitTi86InteractionRequest(state, invokeRequest(), {
      interruptAfterMutation: 1,
    })).toThrow(Ti86InteractionMutationInterrupted);
    expect(decodeTi86InteractionRequest(state.get('DSTREQ')).requestId).toBe(17);
    expect(reconcileTi86InteractionRequest(state)).toMatchObject({ status: 'repaired' });
    expect(inspectTi86InteractionState(state)).toMatchObject({
      status: 'request_pending',
      selection: { state: { nextRequestId: 18, view: 'sync' } },
    });
    expect(reconcileTi86InteractionRequest(state)).toMatchObject({ status: 'retained' });
  });

  it.each([1, 2, 3, 4])('converges after every acknowledged promotion cut %i', (cut) => {
    const state = variables();
    commitTi86InteractionRequest(state, invokeRequest());
    state.set(TI86_INTERACTION_VARIABLES.stage, response('complete'));
    try {
      promoteTi86InteractionResponse(state, { interruptAfterMutation: cut });
    } catch (error) {
      expect(error).toBeInstanceOf(Ti86InteractionMutationInterrupted);
    }
    const recovered = promoteTi86InteractionResponse(state);
    expect(recovered.response).toMatchObject({
      status: 'complete', requestId: 17,
      session: { sessionId: 'rem-17', currentTurn: { choices: [{ id: 'A' }, { id: 'B' }] } },
    });
    expect(state.has('DSTREQ')).toBe(false);
    expect(state.has('DSTNEW')).toBe(false);
    expect(inspectTi86InteractionState(state).status).toBe('response_ready');
  });

  it('retains the exact request for processing/retry and rejects foreign or mismatched staging', () => {
    const state = variables();
    commitTi86InteractionRequest(state, invokeRequest());
    state.set(TI86_INTERACTION_VARIABLES.stage, response('processing'));
    expect(promoteTi86InteractionResponse(state).response).toMatchObject({
      status: 'processing', retryable: true, acknowledgeRequest: false,
    });
    expect(state.has('DSTREQ')).toBe(true);

    const mismatch = variables();
    commitTi86InteractionRequest(mismatch, invokeRequest());
    mismatch.set(TI86_INTERACTION_VARIABLES.stage, codec.encodeInteractionResponse({
      schema: 'school.calc.interaction-response/v1', deviceId, learnerKey, requestId: 18,
      status: 'unavailable', acknowledgeRequest: true, retryable: false, message: 'Gone.',
    }));
    expect(() => promoteTi86InteractionResponse(mismatch)).toThrow(/exact durable SCTQ/);

    const foreign = variables();
    commitTi86InteractionRequest(foreign, invokeRequest());
    foreign.set(TI86_INTERACTION_VARIABLES.stage, new Ti86SchoolCalcCodec().encodeInteractionResponse({
      schema: 'school.calc.interaction-response/v1', deviceId: '86B002', learnerKey,
      requestId: 17, status: 'unavailable', acknowledgeRequest: true,
      retryable: false, message: 'Gone.',
    }));
    expect(() => promoteTi86InteractionResponse(foreign)).toThrow(/selected calculator learner/);
  });
});
