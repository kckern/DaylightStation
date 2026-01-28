import { DomainError } from '#system/utils/errors/index.mjs';

/**
 * Base error class for application layer errors.
 *
 * @class ApplicationError
 */
export class ApplicationError extends DomainError {
  static defaultCode = 'APPLICATION_ERROR';
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
