/**
 * Business rule violation error - operation would break domain rules.
 *
 * @class DomainInvariantError
 * @extends Error
 */
export class DomainInvariantError extends Error {
  constructor(message, { code, details } = {}) {
    super(message);
    this.name = 'DomainInvariantError';
    this.code = code;
    this.details = details;
  }
}
