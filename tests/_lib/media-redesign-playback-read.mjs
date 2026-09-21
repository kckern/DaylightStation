import { ContentSourceRegistry } from '../../backend/src/1_adapters/content/ContentSourceRegistry.mjs';
import { RegistryContentCatalogGateway } from '../../backend/src/1_adapters/content/RegistryContentCatalogGateway.mjs';
import { ContentIdResolver } from '../../backend/src/3_applications/content/ContentIdResolver.mjs';
import { PlaybackReadService } from '../../backend/src/3_applications/content/services/PlaybackReadService.mjs';
import { PlayResponseService } from '../../backend/src/3_applications/content/services/PlayResponseService.mjs';

// Actual branch descriptor/format/URL/session composition. Only progress storage
// is delegated to the existing upstream's read-only, already-resolved spot.
// This avoids opening production storage or starting sync/background jobs.
// It is not independent acceptance of progress reconciliation or bookmarks.
export function createAcceptancePlaybackRead({ adapter, upstream, fetchImpl = fetch, logger = console }) {
  const registry = new ContentSourceRegistry();
  registry.register(adapter);
  const contentCatalog = new RegistryContentCatalogGateway({ registry, logger });
  const mediaProgressMemory = {
    async findProgress(contentId) {
      const url = new URL(`/api/v1/play/${encodeURIComponent(contentId)}`, upstream);
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Acceptance progress source unavailable');
      const body = await response.json();
      if (!(Number.isFinite(body.resume_position) && body.resume_position > 0
        && Number.isFinite(body.duration) && body.duration > 0)) return null;
      return { contentId, playhead: body.resume_position, duration: body.duration };
    },
  };
  return new PlaybackReadService({
    contentIdResolver: new ContentIdResolver(contentCatalog), contentCatalog,
    playResponseService: new PlayResponseService({ mediaProgressMemory, logger }), logger,
  });
}
