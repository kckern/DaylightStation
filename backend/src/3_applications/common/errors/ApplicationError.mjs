import { SemanticApplicationError } from './SemanticErrors.mjs';

/**
 * Base error class for application layer errors.
 *
 * @class ApplicationError
 */
export class ApplicationError extends SemanticApplicationError {
  static defaultCode = 'APPLICATION_ERROR';

  constructor(message, context = {}) {
    super(message, {
      code: context.code || ApplicationError.defaultCode,
      context,
    });
    // Preserve the legacy semantic category used by API-boundary error maps.
    // The application layer does not own an HTTP status.
    this.name = 'DomainError';
  }
}

/**
 * Error thrown when a required service or resource is not found.
 *
 * @class ServiceNotFoundError
 */
export class ServiceNotFoundError extends ApplicationError {
  static defaultCode = 'SERVICE_NOT_FOUND';

  constructor(serviceName, serviceId) {
    super(`${serviceName} not found: ${serviceId}`, {
      code: ServiceNotFoundError.defaultCode,
      serviceName,
      serviceId
    });
    this.name = 'ServiceNotFoundError';
  }
}

/**
 * Error thrown when an operation is not supported.
 *
 * @class UnsupportedOperationError
 */
export class UnsupportedOperationError extends ApplicationError {
  static defaultCode = 'UNSUPPORTED_OPERATION';

  constructor(operation, reason) {
    super(`Operation not supported: ${operation}${reason ? ` - ${reason}` : ''}`, {
      code: UnsupportedOperationError.defaultCode,
      operation,
      reason
    });
    this.name = 'UnsupportedOperationError';
  }
}

export default ApplicationError;
