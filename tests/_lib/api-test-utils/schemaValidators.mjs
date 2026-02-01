// tests/integration/api/_utils/schemaValidators.mjs
/**
 * Schema validators for API response shapes.
 * Validates structural invariants without checking actual data values.
 */

/**
 * Schema definitions for API responses.
 * Each schema defines required fields and their types.
 */
export const SCHEMAS = {
  // LocalContent schemas
  scripture: {
    required: ['reference', 'assetId', 'mediaUrl', 'verses'],
    types: {
      reference: 'string',
      assetId: 'string',
      mediaUrl: 'string',
      duration: 'number',
      verses: 'array'
    }
  },

  hymn: {
    required: ['title', 'number', 'assetId', 'mediaUrl'],
    types: {
      title: 'string',
      number: 'number',
      assetId: 'string',
      mediaUrl: 'string',
      duration: 'number',
      verses: 'array',
      lyrics: 'array'
    }
  },

  primary: {
    required: ['title', 'number', 'assetId', 'mediaUrl'],
    types: {
      title: 'string',
      number: 'number',
      assetId: 'string',
      mediaUrl: 'string',
      duration: 'number',
      verses: 'array',
      lyrics: 'array'
    }
  },

  talk: {
    required: ['title', 'assetId', 'mediaUrl'],
    types: {
      title: 'string',
      speaker: 'string',
      assetId: 'string',
      mediaUrl: 'string',
      duration: 'number',
      content: 'array'
    }
  },

  poem: {
    required: ['title', 'assetId'],
    types: {
      title: 'string',
      author: 'string',
      assetId: 'string',
      mediaUrl: 'string',
      duration: 'number',
      verses: 'array'
    }
  },

  // List response schemas
  listResponse: {
    required: ['source', 'path', 'items'],
    types: {
      source: 'string',
      path: 'string',
      title: 'string',
      items: 'array'
    }
  },

  listItem: {
    required: ['id', 'title'],
    types: {
      id: 'string',
      title: 'string',
      itemType: 'string',
      childCount: 'number',
      thumbnail: 'string'
    }
  },

  // Play response schemas
  playResponse: {
    required: ['id', 'assetId'],
    types: {
      id: 'string',
      assetId: 'string',
      mediaUrl: 'string',
      mediaType: 'string',
      title: 'string',
      duration: 'number',
      thumbnail: 'string'
    }
  },

  // Plex-specific schemas
  plexEpisode: {
    required: ['id', 'assetId', 'title'],
    types: {
      id: 'string',
      assetId: 'string',
      mediaUrl: 'string',
      title: 'string',
      show: 'string',
      season: 'string',
      duration: 'number'
    }
  },

  // Progress/watch state schemas
  progressResponse: {
    required: ['itemId', 'playhead', 'duration'],
    types: {
      itemId: 'string',
      playhead: 'number',
      duration: 'number',
      percent: 'number',
      watched: 'boolean'
    }
  },

  // Fitness/playable content schemas with canonical hierarchy fields
  fitnessShowPlayable: {
    required: ['id', 'title', 'items', 'parents'],
    types: {
      id: 'string',
      title: 'string',
      items: 'array',
      parents: 'object'
    }
  },

  playableItem: {
    required: ['id', 'title', 'parentId'],
    types: {
      id: 'string',
      title: 'string',
      parentId: 'string',
      parentTitle: 'string',
      parentIndex: 'number',
      parentType: 'string',
      itemIndex: 'number',
      grandparentId: 'string',
      grandparentTitle: 'string',
      grandparentType: 'string'
    }
  },

  // Parent container entry in parents map
  parentContainer: {
    required: ['title'],
    types: {
      index: 'number',
      title: 'string',
      thumbnail: 'string',
      type: 'string'
    }
  }
};

/**
 * Validate an object against a schema.
 *
 * @param {Object} data - Data to validate
 * @param {string} schemaName - Name of schema from SCHEMAS
 * @throws {Error} If validation fails
 */
export function validateSchema(data, schemaName) {
  const schema = SCHEMAS[schemaName];

  if (!schema) {
    throw new Error(`Unknown schema: ${schemaName}`);
  }

  const errors = [];

  // Check required fields
  for (const field of schema.required || []) {
    if (data[field] === undefined) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Check types for present fields
  for (const [field, expectedType] of Object.entries(schema.types || {})) {
    if (data[field] !== undefined) {
      const actualType = getType(data[field]);
      // Allow null for optional fields (not in required list)
      const isOptional = !schema.required?.includes(field);
      if (actualType !== expectedType && !(isOptional && actualType === 'null')) {
        errors.push(`Field '${field}' has wrong type: expected ${expectedType}, got ${actualType}`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Schema validation failed for '${schemaName}':\n` +
      errors.map(e => `  - ${e}`).join('\n') +
      `\n\nReceived data:\n${JSON.stringify(data, null, 2).slice(0, 500)}`
    );
  }
}

/**
 * Get JavaScript type as string.
 */
function getType(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

/**
 * Validate list items have required fields.
 *
 * @param {Array} items - Array of list items
 * @param {Object} options
 * @param {number} options.minCount - Minimum expected items (default: 0)
 */
export function validateListItems(items, options = {}) {
  const { minCount = 0 } = options;

  if (!Array.isArray(items)) {
    throw new Error('Expected items to be an array');
  }

  if (items.length < minCount) {
    throw new Error(`Expected at least ${minCount} items, got ${items.length}`);
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    if (!item.id) {
      throw new Error(`Item at index ${i} missing 'id' field`);
    }

    if (!item.title) {
      throw new Error(`Item at index ${i} missing 'title' field`);
    }
  }
}

/**
 * Validate verses array structure (for scripture/hymns).
 *
 * @param {Array} verses - Array of verse objects
 */
export function validateVerses(verses) {
  if (!Array.isArray(verses)) {
    throw new Error('Expected verses to be an array');
  }

  if (verses.length === 0) {
    throw new Error('Verses array is empty');
  }

  for (let i = 0; i < verses.length; i++) {
    const verse = verses[i];

    if (typeof verse !== 'object' || verse === null) {
      throw new Error(`Verse at index ${i} is not an object`);
    }

    // Most verses should have either text or content
    if (!verse.text && !verse.content && !verse.line && !verse.lines) {
      // Some verse formats may differ - just warn
      console.warn(`Verse at index ${i} has no recognizable text field`);
    }
  }
}

/**
 * Assert response is a valid error response.
 *
 * @param {Object} data - Response body
 * @param {number} expectedStatus - Expected HTTP status
 */
export function validateErrorResponse(data, expectedStatus) {
  if (!data.error) {
    throw new Error('Error response missing "error" field');
  }

  if (typeof data.error !== 'string') {
    throw new Error('Error response "error" field should be a string');
  }
}

/**
 * Validate parents map structure (for playable responses with hierarchy).
 *
 * @param {Object} parents - Map of parent containers keyed by ID
 * @param {Object} options
 * @param {number} options.minCount - Minimum expected parents (default: 1)
 */
export function validateParentsMap(parents, options = {}) {
  const { minCount = 1 } = options;

  if (!parents || typeof parents !== 'object') {
    throw new Error('Expected parents to be an object');
  }

  const entries = Object.entries(parents);

  if (entries.length < minCount) {
    throw new Error(`Expected at least ${minCount} parent entries, got ${entries.length}`);
  }

  for (const [id, container] of entries) {
    if (!id) {
      throw new Error('Parent map has entry with empty key');
    }

    if (!container.title) {
      throw new Error(`Parent container '${id}' missing 'title' field`);
    }

    if (container.index !== undefined && typeof container.index !== 'number') {
      throw new Error(`Parent container '${id}' has non-number index`);
    }
  }
}

export default validateSchema;
