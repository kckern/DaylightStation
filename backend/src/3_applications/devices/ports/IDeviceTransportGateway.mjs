export class IDeviceTransportGateway {
  buildCommand(_command) { throw new Error('buildCommand must be implemented'); }
  validateCommand(_command) { throw new Error('validateCommand must be implemented'); }
  sendCommand(_deviceId, _command, _options) { throw new Error('sendCommand must be implemented'); }
  waitForStateChange(_deviceId, _predicate, _timeoutMs) { throw new Error('waitForStateChange must be implemented'); }
  subscribeDeviceStates(_listener) { throw new Error('subscribeDeviceStates must be implemented'); }
  publishDeviceState(_state) { throw new Error('publishDeviceState must be implemented'); }
  subscribeHandlerActivity(_listener) { throw new Error('subscribeHandlerActivity must be implemented'); }
  subscribeScreenPresence(_listener) { throw new Error('subscribeScreenPresence must be implemented'); }
  subscribeScreenDisconnections(_listener) { throw new Error('subscribeScreenDisconnections must be implemented'); }
  screenSubscriberCount(_deviceId) { throw new Error('screenSubscriberCount must be implemented'); }
  deliverQueue(_request) { throw new Error('deliverQueue must be implemented'); }
  publishProgress(_progress) { throw new Error('publishProgress must be implemented'); }
  watchPlayback(_options) { throw new Error('watchPlayback must be implemented'); }
}

export function isDeviceTransportGateway(value) {
  return value != null
    && typeof value.buildCommand === 'function'
    && typeof value.validateCommand === 'function'
    && typeof value.sendCommand === 'function'
    && typeof value.waitForStateChange === 'function';
}

export default IDeviceTransportGateway;
