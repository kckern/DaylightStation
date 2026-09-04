import { invalidateApiResources } from '../../lib/hooks/useApiResource.js';

export const refreshHealthResources = () => invalidateApiResources(path =>
  path.startsWith('api/v1/health/') || path === 'api/v1/lifelog/weight');
