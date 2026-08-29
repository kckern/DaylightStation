/** Semantic source of ambient sensor readings. */
export class IAmbientSensorGateway {
  async getCurrentStates(_entities) {
    throw new Error('IAmbientSensorGateway.getCurrentStates must be implemented');
  }

  subscribe(_entities, _onReading) {
    throw new Error('IAmbientSensorGateway.subscribe must be implemented');
  }
}

export function isAmbientSensorGateway(value) {
  return value != null
    && typeof value.getCurrentStates === 'function'
    && typeof value.subscribe === 'function';
}

export default IAmbientSensorGateway;
