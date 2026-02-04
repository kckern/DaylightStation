// tests/_lib/schemas/contentSearchSchemas.mjs
/**
 * Zod schemas for ContentSearchCombobox API responses
 * Used for validating /api/v1/list and /api/v1/content/query/search responses
 */
import { z } from 'zod';

// Base item schema - common fields across all sources
export const ContentItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  type: z.string().optional(),
  itemType: z.enum(['container', 'leaf']).optional(),
  source: z.string().optional(),
  localId: z.string().optional(),
  thumbnail: z.string().url().optional().nullable(),
  imageUrl: z.string().url().optional().nullable(),
  isContainer: z.boolean().optional(),
  metadata: z.object({
    type: z.string().optional(),
    parentTitle: z.string().optional(),
    parentId: z.string().optional(),
  }).passthrough().optional(),
});

// List endpoint response
export const ListResponseSchema = z.object({
  items: z.array(ContentItemSchema),
  total: z.number().optional(),
  path: z.string().optional(),
  source: z.string().optional(),
});

// Search endpoint response
export const SearchResponseSchema = z.object({
  items: z.array(ContentItemSchema),
  query: z.object({
    text: z.string().optional(),
    source: z.string().optional(),
    take: z.number().optional(),
    skip: z.number().optional(),
  }).passthrough().optional(),
  total: z.number().optional(),
});

// Error response schema
export const ErrorResponseSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  details: z.any().optional(),
});

/**
 * Validate a list response
 * @param {Object} data - Response data
 * @returns {{valid: boolean, errors?: string[]}}
 */
export function validateListResponse(data) {
  const result = ListResponseSchema.safeParse(data);
  if (result.success) return { valid: true };
  return {
    valid: false,
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
  };
}

/**
 * Validate a search response
 * @param {Object} data - Response data
 * @returns {{valid: boolean, errors?: string[]}}
 */
export function validateSearchResponse(data) {
  const result = SearchResponseSchema.safeParse(data);
  if (result.success) return { valid: true };
  return {
    valid: false,
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
  };
}

/**
 * Validate item has required display fields
 * @param {Object} item - Content item
 * @returns {{valid: boolean, errors?: string[]}}
 */
export function validateDisplayFields(item) {
  const errors = [];

  if (!item.id) errors.push('Missing id');
  if (!item.title) errors.push('Missing title');

  // Must have either thumbnail or type for icon fallback
  if (!item.thumbnail && !item.imageUrl && !item.type && !item.metadata?.type) {
    errors.push('Missing thumbnail and type (no icon fallback possible)');
  }

  // ID must be parseable as source:localId
  if (item.id && !item.id.includes(':') && !/^\d+$/.test(item.id)) {
    errors.push(`ID "${item.id}" not in source:localId format`);
  }

  return { valid: errors.length === 0, errors };
}
