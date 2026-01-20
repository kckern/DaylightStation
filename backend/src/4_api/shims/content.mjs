// backend/src/4_api/shims/content.mjs

/**
 * Content shims transform new API responses to legacy format.
 * Used during migration to maintain frontend compatibility.
 */

export const contentShims = {
  'content-list-v1': {
    name: 'content-list-v1',
    description: 'Transforms content list response to legacy format',
    transform: (newResponse) => {
      // Placeholder - implement when content schema changes
      return newResponse;
    },
  },
};
