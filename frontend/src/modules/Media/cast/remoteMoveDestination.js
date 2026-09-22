import { DaylightAPI } from '../../../lib/api.mjs';
import { validateHandoffCommandAck } from '@shared-contracts/media/handoff.mjs';

function command(operationId, op, params = {}) {
  return {
    commandId: `${operationId}:${op}`,
    command: 'handoff',
    params: { version: 1, transferId: operationId, op, ...params },
  };
}

function explicitFailure(response, operationId) {
  const handoff = response?.handoff;
  if (handoff?.transferId !== operationId || handoff?.phase !== 'failed') return null;
  return { status: 'rejected', reason: handoff.code ?? response.code ?? 'destination-rejected' };
}

async function postHandoff(http, deviceId, envelope) {
  return http(`api/v1/device/${deviceId}/session/handoff`, {
    commandId: envelope.commandId,
    params: envelope.params,
  }, 'POST');
}

export function createRemoteMoveDestination({ deviceId, http = DaylightAPI } = {}) {
  return {
    async adopt(request) {
      if (request.destinationId !== deviceId) {
        return { status: 'rejected', reason: 'destination-mismatch' };
      }

      const captureCommand = command(request.operationId, 'capture');
      let captureResponse;
      try {
        captureResponse = await postHandoff(http, deviceId, captureCommand);
      } catch (error) {
        return { status: 'uncertain', reason: error?.message ?? 'capture-not-confirmed' };
      }
      const captureFailure = explicitFailure(captureResponse, request.operationId);
      if (captureFailure) return captureFailure;
      const captureValidation = validateHandoffCommandAck(captureCommand, captureResponse, {
        target: { kind: 'device', id: deviceId },
      });
      const destinationCapture = captureResponse?.handoff?.capture;
      if (!captureValidation.valid || captureResponse?.handoff?.phase !== 'captured'
        || destinationCapture?.capabilities?.handoffV1 !== true) {
        return { status: 'uncertain', reason: 'capture-not-confirmed' };
      }

      const startCommand = command(request.operationId, 'start', {
        snapshot: request.snapshot,
        expectedDestination: destinationCapture.identity,
        positionPolicy: request.snapshot.currentItem?.isLive === true
          ? { kind: 'live-edge' }
          : { kind: 'absolute', seconds: request.snapshot.position ?? 0 },
      });
      let startResponse;
      try {
        startResponse = await postHandoff(http, deviceId, startCommand);
      } catch (error) {
        return { status: 'uncertain', reason: error?.message ?? 'start-not-confirmed' };
      }
      const startFailure = explicitFailure(startResponse, request.operationId);
      if (startFailure) return startFailure;
      const startValidation = validateHandoffCommandAck(startCommand, startResponse, {
        target: { kind: 'device', id: deviceId },
      });
      const receipt = startResponse?.handoff?.receipt;
      if (!startValidation.valid || startResponse?.handoff?.phase !== 'started'
        || !Number.isInteger(receipt?.identity?.playbackRevision)) {
        return { status: 'uncertain', reason: 'start-not-confirmed' };
      }
      return { status: 'adopted', destinationRevision: receipt.identity.playbackRevision };
    },
  };
}

export default createRemoteMoveDestination;
