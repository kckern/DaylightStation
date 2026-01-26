/**
 * Entity lookup error - referenced entity doesn't exist.
 *
 * @class EntityNotFoundError
 * @extends Error
 */
export class EntityNotFoundError extends Error {
  constructor(entityType, entityId, { details } = {}) {
    super(`${entityType} not found: ${entityId}`);
    this.name = 'EntityNotFoundError';
    this.entityType = entityType;
    this.entityId = entityId;
    this.details = details;
  }
}
