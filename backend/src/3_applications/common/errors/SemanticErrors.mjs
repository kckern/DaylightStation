/**
 * Transport-neutral application error categories.
 *
 * These deliberately do not extend the system DomainError hierarchy: that
 * hierarchy carries an `httpStatus`, while application workflows must remain
 * usable from HTTP, jobs, CLIs, and message consumers without choosing a
 * transport response. API adapters map these semantic names/codes at their
 * boundary.
 */
export class SemanticApplicationError extends Error {
  constructor(message, { code = 'APPLICATION_ERROR', context, details } = {}) {
    super(message);
    this.name = 'SemanticApplicationError';
    this.code = code;
    if (context !== undefined) this.context = context;
    if (details !== undefined) this.details = details;
  }
}

export class InvalidInputError extends SemanticApplicationError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      code: Object.hasOwn(options, 'code') ? options.code : 'VALIDATION_ERROR',
    });
    // Existing API error middleware recognizes this semantic category by name.
    this.name = 'ValidationError';
  }
}

export class MissingResourceError extends SemanticApplicationError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      code: Object.hasOwn(options, 'code') ? options.code : 'NOT_FOUND',
    });
    this.name = 'NotFoundError';
  }
}

export class StateConflictError extends SemanticApplicationError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      code: Object.hasOwn(options, 'code') ? options.code : 'CONFLICT',
    });
    this.name = 'ConflictError';
  }
}

export class OperationUnavailableError extends SemanticApplicationError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      code: Object.hasOwn(options, 'code') ? options.code : 'OPERATION_UNAVAILABLE',
    });
    this.name = 'OperationUnavailableError';
  }
}

export class PayloadTooLargeError extends SemanticApplicationError {
  constructor(message, { limit, ...options } = {}) {
    super(message, {
      ...options,
      code: Object.hasOwn(options, 'code') ? options.code : 'PAYLOAD_TOO_LARGE',
    });
    this.name = 'PayloadTooLargeError';
    this.limit = limit;
  }
}

// Compatibility names for application services whose public error contracts
// predate the semantic class names above. They intentionally preserve the
// names/codes consumed by API-boundary status maps without importing the
// retired system/domain error hierarchy.
export class ValidationError extends SemanticApplicationError {
  constructor(message, context = {}) {
    super(message, {
      code: context.code || 'VALIDATION_ERROR',
      context,
    });
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends SemanticApplicationError {
  constructor(entityType, identifier, context = {}) {
    if (identifier === undefined) {
      super(entityType, { code: context.code || 'NOT_FOUND', context });
    } else {
      const merged = { entityType, identifier, ...context };
      super(`${entityType} not found: ${identifier}`, {
        code: merged.code || 'NOT_FOUND',
        context: merged,
      });
    }
    this.name = 'NotFoundError';
  }
}

export class AuthorizationError extends SemanticApplicationError {
  constructor(message, context = {}) {
    super(message, {
      code: context.code || 'AUTHORIZATION_ERROR',
      context,
    });
    this.name = 'AuthorizationError';
  }
}

export class ConflictError extends SemanticApplicationError {
  constructor(message, context = {}) {
    super(message, {
      code: context.code || 'CONFLICT',
      context,
    });
    this.name = 'ConflictError';
  }
}

export class ConfigurationError extends SemanticApplicationError {
  constructor(message, { code, key, value, details } = {}) {
    super(message, { code: code || 'CONFIGURATION_ERROR', details });
    this.name = 'ConfigurationError';
    this.key = key;
    this.value = value;
  }
}

export class PersistenceError extends SemanticApplicationError {
  constructor(operation, message, context = {}) {
    const merged = { operation, ...context };
    super(`Persistence ${operation} failed: ${message}`, {
      code: context.code || 'PERSISTENCE_ERROR',
      context: merged,
    });
    this.name = 'PersistenceError';
    this.operation = operation;
    this.retryable = operation === 'read';
  }
}
