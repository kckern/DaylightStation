export class IBiometricGateway {
  requestUnlock(_lockName, _candidates, _options) { throw new Error('requestUnlock must be implemented'); }
  requestEnroll(_request) { throw new Error('requestEnroll must be implemented'); }
  requestDelete(_request) { throw new Error('requestDelete must be implemented'); }
}
export function isBiometricGateway(value) {
  return value != null && typeof value.requestUnlock === 'function'
    && typeof value.requestEnroll === 'function' && typeof value.requestDelete === 'function';
}
export default IBiometricGateway;
