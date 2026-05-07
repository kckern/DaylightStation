// backend/src/3_applications/agents/framework/buildAgentEventQueryService.mjs
import { EventQueryService } from '#apps/agents/health-coach/services/EventQueryService.mjs';

// NOTE: EventQueryService currently lives under health-coach. After this plan,
// it should move to a more neutral location (e.g. #apps/agents/framework or
// #domains/events) since it's framework-level. For now, keeping the import
// path; the smell is contained inside this helper. Bootstrap doesn't import
// EventQueryService directly anymore after Task 4.

/**
 * Per-agent EventQueryService factory. Returns null when no usable adapters
 * are provided so agents that don't use event surfaces (echo, paged-media-toc)
 * skip construction entirely.
 *
 * @param {Record<string, IEventAdapter|null>|null} adapters — kind→adapter map.
 *   Null/undefined entries are stripped before constructing the dispatcher.
 * @param {object|null} baselineService — for vs_baseline annotation.
 * @returns {EventQueryService|null}
 */
export function buildAgentEventQueryService(adapters, baselineService = null) {
  if (!adapters) return null;
  const cleaned = Object.fromEntries(
    Object.entries(adapters).filter(([, v]) => v != null),
  );
  if (Object.keys(cleaned).length === 0) return null;
  return new EventQueryService({ adapters: cleaned, baselineService });
}

export default buildAgentEventQueryService;
