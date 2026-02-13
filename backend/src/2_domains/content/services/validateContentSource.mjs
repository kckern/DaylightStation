// backend/src/2_domains/content/services/validateContentSource.mjs

/**
 * Validates that an object implements the IContentSource interface.
 * @param {any} adapter
 * @throws {Error} If validation fails
 */
export function validateAdapter(adapter) {
  if (!adapter.source || typeof adapter.source !== 'string') {
    throw new Error('Adapter must have source property (string)');
  }

  if (!Array.isArray(adapter.prefixes)) {
    throw new Error('Adapter must have prefixes array');
  }

  if (typeof adapter.getItem !== 'function') {
    throw new Error('Adapter must implement getItem(id): Promise<Item|null>');
  }

  if (typeof adapter.getList !== 'function') {
    throw new Error('Adapter must implement getList(id): Promise<Listable[]>');
  }

  if (typeof adapter.resolvePlayables !== 'function') {
    throw new Error('Adapter must implement resolvePlayables(id): Promise<Playable[]>');
  }

  if (typeof adapter.resolveSiblings !== 'function') {
    throw new Error('Adapter must implement resolveSiblings(compoundId): Promise<{parent, items}|null>');
  }
}
