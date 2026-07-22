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

/**
 * The physical presence gate refused this work → HTTP 423 (Locked).
 *
 * Its own type, carrying the resolved gate, because the frontend has to tell
 * "gate closed" apart from "not signed in" and "session expired" in order to
 * render a remedy screen rather than a toast. Reusing GuestForbiddenError left
 * it string-matching an error message.
 *
 * @class GateClosedError
 * @extends Error
 */
export class GateClosedError extends Error {
  constructor(message, { level, missing = [], stale = false } = {}) {
    super(message);
    this.name = 'GateClosedError';
    this.level = level;
    this.missing = missing;
    this.stale = stale;
  }
}
