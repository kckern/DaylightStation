/**
 * Guest session attempted against an audience:assigned bank → HTTP 403.
 *
 * @class GuestForbiddenError
 * @extends Error
 */
export class GuestForbiddenError extends Error {
  constructor(message, { bankId, details } = {}) {
    super(message);
    this.name = 'GuestForbiddenError';
    this.bankId = bankId;
    this.details = details;
  }
}

/**
 * Unknown or expired sessionId → HTTP 410.
 *
 * @class SessionGoneError
 * @extends Error
 */
export class SessionGoneError extends Error {
  constructor(message, { sessionId, details } = {}) {
    super(message);
    this.name = 'SessionGoneError';
    this.sessionId = sessionId;
    this.details = details;
  }
}
