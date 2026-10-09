/** Candidate construction surface consumes owned public entries and shared infrastructure. */
import { createGratitudeServices, createGratitudeApiRouter } from '../../../../modules/gratitude/server/public.mjs';
// White-box constructors support the existing case surface; production consumers use public composition.
import { createGratitudeRouter } from '../../../../modules/gratitude/server/api/gratitude.mjs';
import { GratitudeService } from '../../../../modules/gratitude/server/application/services/GratitudeService.mjs';
import { GratitudeHouseholdService } from '../../../../modules/gratitude/server/application/services/GratitudeHouseholdService.mjs';
import { GratitudeCardPrintService } from '../../../../modules/gratitude/server/application/services/GratitudeCardPrintService.mjs';
import { GratitudeEvents } from '../../../../modules/gratitude/server/application/events/GratitudeEvents.mjs';
import { YamlGratitudeDatastore } from '../../../../modules/gratitude/server/adapters/persistence/YamlGratitudeDatastore.mjs';
import { TemporaryImagePrintGateway } from '../../../../modules/gratitude/server/print-gateway.mjs';
import { createApiRouter } from '../../../../backend/src/4_api/v1/routers/api.mjs';
import { errorHandlerMiddleware } from '../../../../backend/src/0_system/http/middleware/errorHandler.mjs';
import { permissionGate } from '../../../../backend/src/4_api/middleware/permissionGate.mjs';
import { GratitudeFeedAdapter as FeedAdapter } from '../../../../backend/src/1_adapters/feed/sources/GratitudeFeedAdapter.mjs';
import { DataService } from '../../../../backend/src/1_adapters/persistence/files/DataService.mjs';
import { ConfigService } from '../../../../backend/src/0_system/config/ConfigService.mjs';
import { YamlAdminConfigStore } from '../../../../backend/src/1_adapters/persistence/yaml/YamlAdminConfigStore.mjs';
import { YamlConfigFileService } from '../../../../backend/src/3_applications/admin/YamlConfigFileService.mjs';
import { createAdminConfigRouter } from '../../../../backend/src/4_api/v1/routers/admin/config.mjs';
// Preserve the unchanged case fixture's construction shape across the narrower Feed port.
class GratitudeFeedAdapter extends FeedAdapter {
  constructor({dataService,...ports}) {
    super({...ports,readSelectionQuotes:()=>dataService.household.read('gratitude/selections.gratitude.yml')});
  }
}
export const implementation={createGratitudeServices,createGratitudeApiRouter,createGratitudeRouter,GratitudeService,GratitudeHouseholdService,GratitudeCardPrintService,GratitudeEvents,YamlGratitudeDatastore,TemporaryImagePrintGateway,createApiRouter,errorHandlerMiddleware,
  permissionGate,GratitudeFeedAdapter,DataService,ConfigService,YamlAdminConfigStore,YamlConfigFileService,createAdminConfigRouter};
