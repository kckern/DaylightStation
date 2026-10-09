import { ProxyMediaService } from "../application/proxy/ProxyMediaService.mjs";
import { CompositeHeroService } from "../application/proxy/CompositeHeroService.mjs";
import { RemoteThumbnailService } from "../application/proxy/RemoteThumbnailService.mjs";
import { DynamicStreamService } from "../application/proxy/DynamicStreamService.mjs";
import { MintPlaybackStream } from "../application/proxy/MintPlaybackStream.mjs";
import { FilesystemProxyMediaRepository } from "#adapters/proxy/FilesystemProxyMediaRepository.mjs";
import { FilesystemProxyAssetCache } from "#adapters/proxy/FilesystemProxyAssetCache.mjs";
import { KomgaCompositeImageSource } from "#adapters/proxy/KomgaCompositeImageSource.mjs";
import { XploreThumbnailSource } from "#adapters/proxy/XploreThumbnailSource.mjs";
import { HttpDynamicStreamGateway } from "#adapters/proxy/HttpDynamicStreamGateway.mjs";
import { RegistryPlaybackStreamGateway } from "#adapters/proxy/RegistryPlaybackStreamGateway.mjs";
import { compositeHeroImage } from "#rendering/canvas/compositeHero.mjs";

export function createCatalogProxyServices({ logger, mediaBasePath, registry, proxyService, configService, retroarchProxy }) {
  const proxyLogger = logger.child?.({ module: 'proxy-api' }) || logger;
  const proxyAssetCache = new FilesystemProxyAssetCache({ mediaBasePath });
  const proxyMediaService = new ProxyMediaService({
    repository: new FilesystemProxyMediaRepository({ registry, mediaBasePath, logger: proxyLogger }),
  });
  const mintPlaybackStream = new MintPlaybackStream({
    gateway: new RegistryPlaybackStreamGateway({ registry, logger: proxyLogger }),
  });
  const compositeHeroService = new CompositeHeroService({
    cache: proxyAssetCache,
    source: new KomgaCompositeImageSource({ adapter: proxyService?.getAdapter?.('komga') }),
    render: compositeHeroImage,
  });
  const dynamicStreamService = new DynamicStreamService({
    gateway: new HttpDynamicStreamGateway({
      getProfiles: () => configService?.getStreamingProfiles?.() || [],
    }),
    logger: proxyLogger,
  });
  const remoteThumbnailService = retroarchProxy
    ? new RemoteThumbnailService({
      cache: proxyAssetCache,
      source: new XploreThumbnailSource({
        baseUrl: retroarchProxy.baseUrl,
        thumbnailsPath: retroarchProxy.thumbnailsPath,
      }),
      delay: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      retryDelayMs: 1500,
      logger: proxyLogger,
    })
    : null;
  return { proxyLogger, proxyMediaService, mintPlaybackStream, compositeHeroService, dynamicStreamService, remoteThumbnailService };
}
