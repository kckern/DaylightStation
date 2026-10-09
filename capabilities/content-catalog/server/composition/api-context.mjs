import { createContentRouter } from "../api/content.mjs";
import { ContentAliasCatalogService } from "../application/services/ContentAliasCatalogService.mjs";
import { RegistryContentCatalogGateway } from "../adapters/RegistryContentCatalogGateway.mjs";
import { ListNameCatalog } from "../adapters/providers/list/ListNameCatalog.mjs";
import { ItemService } from "../application/ItemService.mjs";
import { ContentIdResolver } from "../application/ContentIdResolver.mjs";
import { ContentQueryService } from "../application/ContentQueryService.mjs";
import { LegacyLocalContentService } from "../application/LegacyLocalContentService.mjs";
import { ContentQueryAliasResolver } from "../application/services/ContentQueryAliasResolver.mjs";
import { SiblingsService } from "../application/services/SiblingsService.mjs";
import { isMediaSearchable } from "../application/services/isMediaSearchable.mjs";
import path from "path";
import { ContentDiscoveryService } from "../application/services/ContentDiscoveryService.mjs";
import { ListBrowseService } from "../application/services/ListBrowseService.mjs";
import { generatePlaceholderImage } from "#rendering/placeholder/placeholderImage.mjs";
import { NodePromiseDeadline } from "#adapters/scheduling/NodePromiseDeadline.mjs";
import { LegacyLocalContentRepository } from "../adapters/LegacyLocalContentRepository.mjs";
import { buildBareContentNameMap, CONTENT_SEARCH_BUDGET, LEGACY_CONTENT_ALIASES } from "../application/ContentRuntimePolicy.mjs";

export function createContentQueryContext({ prefixAliases, registry, logger, configService, mediaProgressMemory }) {
  // Register prefix aliases (e.g., hymn → singalong:hymn) from config
  // This enables the content API to resolve aliased prefixes via registry.resolveFromPrefix()
  if (Object.keys(prefixAliases).length > 0) {
    registry.registerPrefixAliases(prefixAliases);
    logger.debug?.('bootstrap.prefixAliases.registered', { prefixes: Object.keys(prefixAliases) });
  }

  // Scan list directories for bare name resolution (Layer 4a).
  // Priority: menu > program > watchlist (later iterations overwrite).
  const bareNameMap = buildBareContentNameMap(new ListNameCatalog({ listAdapter: registry.get('list') }));

  // Create ContentIdResolver for unified content ID resolution.
  // Prefix aliases (hymn, scripture, etc.) are already registered in the registry
  // via registerPrefixAliases() above — ContentIdResolver Layer 2 resolves them.
  // systemAliases is reserved for future aliases not backed by registry prefixes.
  const contentCatalog = new RegistryContentCatalogGateway({ registry, isSearchable: isMediaSearchable, prefixAliases, logger });
  const contentIdResolver = new ContentIdResolver(contentCatalog, {
    systemAliases: LEGACY_CONTENT_ALIASES,
    householdAliases: {},
    bareNameMap,
  });

  // Create ContentQueryAliasResolver for semantic query prefixes (music:, photos:, etc.)
  const aliasResolver = new ContentQueryAliasResolver({
    contentCatalog,
    loadUserAliases: () => configService.getAppConfig('content', 'aliases'),
    prefixAliases,
  });

  // Create ContentQueryService for unified query interface.
  // Per-adapter search budget: 3s default keeps streamed search snappy; the
  // local YAML/file-scan sources measured slower on this host (2026-07 live
  // samples — abs ~3.3-4.9s, singalong ~4.2-7.2s, readalong ~0.9-5.2s,
  // local-content ~0.7-4.0s, files ~1.6-3.9s) get explicit higher budgets so
  // their legitimate results aren't cut off.
  const contentQueryService = new ContentQueryService({
    contentCatalog,
    mediaProgressMemory,
    prefixAliases,
    logger,
    aliasResolver,
    deadline: new NodePromiseDeadline(),
    ...CONTENT_SEARCH_BUDGET,
  });

  // Create SiblingsService for sibling resolution
  const siblingsService = new SiblingsService({ contentCatalog, logger });

  return { contentCatalog, contentIdResolver, aliasResolver, contentQueryService, siblingsService };
}

export function createContentBrowseOperations({ contentCatalog, logger, contentIdResolver, contentQueryService, menuMemory }) {
  const contentDiscovery = new ContentDiscoveryService({ contentCatalog, logger });
  const listBrowse = new ListBrowseService({
    contentCatalog,
    contentIdResolver,
    contentQueryService,
    menuMemory,
    logger,
  });
  const itemService = new ItemService({
    contentCatalog,
    contentQueryService,
    menuMemory,
    logger,
  });
  return { contentDiscovery, listBrowse, itemService };
}

export function createLegacyContentOperations({ registry, dataPath, mediaBasePath, mediaProgressMemory, logger }) {
  const legacyLocalContentService = new LegacyLocalContentService({
    repository: new LegacyLocalContentRepository({
      registry,
      dataPath,
      mediaBasePath,
      mediaProgressMemory,
      generatePlaceholder: generatePlaceholderImage,
      placeholderFontPath: mediaBasePath ? path.join(mediaBasePath, 'fonts/RobotoCondensed-Regular.ttf') : null,
    }),
    logger,
  });

  return { legacyLocalContentService };
}

export function createContentQueryRouter({ cacheBasePath, composePresentationUseCase, contentQueryService, contentAccessPolicy, contentDiscovery, updateContentProgress, contentAlternatesService, validateSearchQuery, logger, aliasResolver }) {
  return createContentRouter({
        cacheBasePath,
        composePresentationUseCase,
        contentQueryService,
        contentAccessPolicy,
        contentDiscovery,
        updateContentProgress,
        findContentAlternates: contentAlternatesService.findAlternates.bind(contentAlternatesService),
        validateSearchQuery,
        logger,
        contentAliasCatalog: new ContentAliasCatalogService({ aliases: aliasResolver, discovery: contentDiscovery }),
      });
}
