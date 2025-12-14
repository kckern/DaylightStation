/**
 * Generic Repository Port Interface
 * @module application/ports/IRepository
 * @template T - Entity type
 */

/**
 * @typedef {Object} FindAllOptions
 * @property {Object} [filter] - Partial entity match filter
 * @property {string} [sortBy] - Field to sort by
 * @property {'asc'|'desc'} [sortOrder='asc'] - Sort direction
 * @property {number} [limit] - Maximum results
 * @property {number} [offset] - Skip results
 */

/**
 * Abstract interface for data persistence
 * 
 * Implementations:
 * - FileRepository: YAML file-based storage using io.mjs
 * - InMemoryRepository: In-memory storage for testing
 * 
 * @interface IRepository
 * @template T - Entity type
 */

/**
 * @typedef {Object} IRepository
 * @template T
 * @property {function} save - Insert or update an entity
 * @property {function} findById - Find entity by ID
 * @property {function} findAll - Find all entities matching filter
 * @property {function} update - Update an existing entity
 * @property {function} delete - Delete an entity
 * @property {function} exists - Check if entity exists
 */

/**
 * Method signatures for IRepository<T>:
 * 
 * save(entity: T, chatId?: string): Promise<T>
 *   - Insert or update entity
 *   - chatId required for per-chat repositories
 *   - Returns saved entity
 * 
 * findById(id: string, chatId?: string): Promise<T | null>
 *   - Find entity by ID
 *   - Returns null if not found
 * 
 * findAll(options?: FindAllOptions, chatId?: string): Promise<T[]>
 *   - Find all entities matching filter
 *   - Returns empty array if none found
 * 
 * update(id: string, changes: Partial<T>, chatId?: string): Promise<T>
 *   - Update existing entity with partial changes
 *   - Throws NotFoundError if entity doesn't exist
 *   - Returns updated entity
 * 
 * delete(id: string, chatId?: string): Promise<void>
 *   - Delete entity by ID
 *   - No-op if entity doesn't exist
 * 
 * exists(id: string, chatId?: string): Promise<boolean>
 *   - Check if entity exists
 */

/**
 * Validate that an object implements IRepository
 * @param {Object} obj - Object to validate
 * @returns {boolean}
 */
export function isRepository(obj) {
  if (!obj || typeof obj !== 'object') return false;
  
  const requiredMethods = [
    'save',
    'findById',
    'findAll',
    'update',
    'delete',
    'exists',
  ];
  
  return requiredMethods.every(method => typeof obj[method] === 'function');
}

/**
 * Create a type-safe wrapper that validates repository implementation
 * @template T
 * @param {T} repository - Repository implementation
 * @returns {T}
 * @throws {Error} if repository doesn't implement IRepository
 */
export function assertRepository(repository) {
  if (!isRepository(repository)) {
    throw new Error('Object does not implement IRepository interface');
  }
  return repository;
}

export default {
  isRepository,
  assertRepository,
};
