/**
 * Input validation error - bad data coming IN to entity/service.
 *
 * @class ValidationError
 * @extends Error
 */
export class ValidationError extends Error {
  constructor(message, context = {}) {
    const { code, field, value, details } = context;
    super(message);
    this.name = 'ValidationError';
    this.context = context;
    this.code = code;
    this.field = field;
    this.value = value;
    this.details = details;
  }
}

export default ValidationError;
