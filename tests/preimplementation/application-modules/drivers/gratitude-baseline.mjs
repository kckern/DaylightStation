/** The baseline target is the sole place this driver names current product paths. */
import { createGratitudeRouter } from '../../../../backend/src/4_api/v1/routers/gratitude.mjs';
import { createApiRouter } from '../../../../backend/src/4_api/v1/routers/api.mjs';
import { errorHandlerMiddleware } from '../../../../backend/src/0_system/http/middleware/errorHandler.mjs';
import { permissionGate } from '../../../../backend/src/4_api/middleware/permissionGate.mjs';
import { GratitudeService } from '../../../../backend/src/3_applications/gratitude/services/GratitudeService.mjs';
import { GratitudeHouseholdService } from '../../../../backend/src/3_applications/gratitude/services/GratitudeHouseholdService.mjs';
import { GratitudeCardPrintService } from '../../../../backend/src/3_applications/gratitude/services/GratitudeCardPrintService.mjs';
import { GratitudeEvents } from '../../../../backend/src/3_applications/events/RealtimePublications.mjs';
import { YamlGratitudeDatastore } from '../../../../backend/src/1_adapters/persistence/yaml/YamlGratitudeDatastore.mjs';
import { GratitudeFeedAdapter } from '../../../../backend/src/1_adapters/feed/sources/GratitudeFeedAdapter.mjs';
import { TemporaryImagePrintGateway } from '../../../../backend/src/1_adapters/hardware/thermal-printer/TemporaryImagePrintGateway.mjs';
import { DataService } from '../../../../backend/src/1_adapters/persistence/files/DataService.mjs';
import { ConfigService } from '../../../../backend/src/0_system/config/ConfigService.mjs';
import { YamlAdminConfigStore } from '../../../../backend/src/1_adapters/persistence/yaml/YamlAdminConfigStore.mjs';
import { YamlConfigFileService } from '../../../../backend/src/3_applications/admin/YamlConfigFileService.mjs';
import { createAdminConfigRouter } from '../../../../backend/src/4_api/v1/routers/admin/config.mjs';

export const implementation = { createGratitudeRouter, createApiRouter, errorHandlerMiddleware, permissionGate, GratitudeService, GratitudeHouseholdService, GratitudeCardPrintService, GratitudeEvents, YamlGratitudeDatastore, GratitudeFeedAdapter, TemporaryImagePrintGateway, DataService, ConfigService, YamlAdminConfigStore, YamlConfigFileService, createAdminConfigRouter };
