import { useApiResource } from '../../../lib/hooks/useApiResource.js';

export const aiUsagePath = 'api/v1/health/ai-usage?days=30';

/** Health's AI spend over the last 30 household days (GET /health/ai-usage). */
export function useHealthAiUsage() {
  return useApiResource(aiUsagePath, { swr: true, label: 'Health AI usage' });
}
