import { scopedGateway } from "#apps/common/ports/IAIGateway.mjs";
import { HttpClient } from "#system/services/HttpClient.mjs";
import { PagedMediaTocAgent } from "./application/agents/paged-media-toc/index.mjs";
import { KomgaPagedMediaAdapter } from "#adapters/komga/KomgaPagedMediaAdapter.mjs";
import { YamlTocCacheDatastore } from "#adapters/persistence/yaml/YamlTocCacheDatastore.mjs";

export function registerPagedMediaToc({ aiGateway, dataService, configService, httpClient, logger, workingMemory, agentOrchestrator, KomgaClient }) {
  // Register paged-media-toc agent (requires AI gateway + paged media server access)
  if (aiGateway && dataService && configService) {
    const komgaAuth = configService.getHouseholdAuth('komga');
    const komgaHost = configService.resolveServiceUrl('komga');
    if (komgaHost && komgaAuth?.token) {
      const komgaClient = new KomgaClient(
        { host: komgaHost, apiKey: komgaAuth.token },
        { httpClient, logger }
      );
      const pagedMediaGateway = new KomgaPagedMediaAdapter({
        client: komgaClient,
        apiKey: komgaAuth.token,
        httpClient: new HttpClient({ logger }),
        logger,
      });
      const tocCacheDatastore = new YamlTocCacheDatastore({ dataService, configService });
      agentOrchestrator.register(PagedMediaTocAgent, {
        workingMemory,
        aiGateway: scopedGateway(aiGateway, { app: 'media', feature: 'paged-media-toc' }),
        pagedMediaGateway,
        tocCacheDatastore,
      });
    }
  }

}
