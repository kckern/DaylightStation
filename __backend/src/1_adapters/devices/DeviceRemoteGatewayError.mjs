/**
 * What a remote-administration gateway throws. `code` is the stable part the
 * API layer maps to an HTTP status; the message is for logs.
 *
 * `reason`, when present, is the device's own fixed explanation of a refusal
 * ("device owner required"). It is not secret and may be shown to an operator.
 */
export class DeviceRemoteGatewayError extends Error {
  constructor(message, code, { reason } = {}) {
    super(message);
    this.name = 'DeviceRemoteGatewayError';
    this.code = code;
    if (reason !== undefined) this.reason = reason;
  }
}

export default DeviceRemoteGatewayError;
