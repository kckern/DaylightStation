export class GamingKernelError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'GamingKernelError';
    this.code = code;
    this.details = details;
  }
}

export class RevisionConflictError extends GamingKernelError {
  constructor(expected, actual) {
    super('revision_conflict', `Expected revision ${expected}, current revision is ${actual}`, { expected, actual });
  }
}

export class IdempotencyConflictError extends GamingKernelError {
  constructor(commandId) {
    super('idempotency_conflict', `Command ${commandId} was reused with different content`);
  }
}
