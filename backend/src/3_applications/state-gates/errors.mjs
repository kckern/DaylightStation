export class StateGatesApplicationError extends Error {
  constructor(message, { code, status = 400, details } = {}) {
    super(message);
    this.name = status === 403 ? 'AuthorizationError' : status === 409 ? 'ConflictError' : 'StateGatesApplicationError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function appError(message, code, status, details) {
  return new StateGatesApplicationError(message, { code, status, details });
}

export function requireAuthorized(result) {
  if (result === true || result?.allowed === true) return;
  throw appError('Forbidden', 'FORBIDDEN', 403);
}
