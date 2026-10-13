import { YamlFoodLogDatastore } from '../adapters/persistence/yaml/YamlFoodLogDatastore.mjs';
import { YamlNutriListDatastore } from '../adapters/persistence/yaml/YamlNutriListDatastore.mjs';
import { PhotoStore } from '../adapters/persistence/PhotoStore.mjs';
import { IconManifestStore } from '../adapters/persistence/IconManifestStore.mjs';

export function createNutritionCaptureStores({ configService, dataService, logger }) {
  // Food log store (YAML persistence)
  const foodLogStore = new YamlFoodLogDatastore({
    configService,
    logger
  });

  // Nutrient list store (YAML persistence)
  const nutriListStore = new YamlNutriListDatastore({
    dataService,
    logger
  });

  // Photo persistence for captured food images (Task 2.3). Same adapter
  // instantiation shape as healthApi.mjs's photo-serving route — both share
  // the users/{userId}/lifelog/nutrition/photos directory via dataService.
  const photoStore = new PhotoStore({ dataService, logger });

  return { foodLogStore, nutriListStore, photoStore };
}

export function createNutritionCaptureVocabulary({ configService, dataService, logger }) {
  let foodIconsString = 'default';
  let mediaRoot = null;
  try { mediaRoot = configService.getMediaDir?.() ?? null; }
  catch (e) { logger.warn?.('nutribot.icons.mediaRootUnavailable', { error: e.message }); }
  const iconManifest = mediaRoot ? new IconManifestStore({ dataService, mediaRoot, logger }) : null;
  const manifestSlugs = iconManifest?.list() || [];
  if (manifestSlugs.length > 0) {
    foodIconsString = manifestSlugs.join(' ');
    logger.info?.('nutribot.icons.loaded', { count: manifestSlugs.length, source: 'manifest' });
  } else {
    logger.warn?.('nutribot.icons.manifestEmpty', { source: 'none', vocabulary: foodIconsString });
  }

  return { foodIconsString, readFoodIconNames: () => iconManifest?.foodNames() || {} };
}
