import { HomeAssistantAmbientSensorGateway } from "../adapters/HomeAssistantAmbientSensorGateway.mjs";
import { EventBusAmbientLightPublications } from "../../../../capabilities/home-control/server/adapters/EventBusAmbientLightPublications.mjs";
import { startAmbientZones } from "../application/home-automation/ambientZones.mjs";
import { projectAmbientZones } from "../../../../capabilities/home-control/server/adapters/ConfiguredAmbientZones.mjs";

export async function startHomeAmbient({ configService, homeAutomationAdapters, rootLogger, eventBus, server }) {
  const ambientConfig = configService.getHouseholdAppConfig(null, 'ambient') || {};
  const ambientZones = projectAmbientZones(ambientConfig);
  const runningAmbientZones = startAmbientZones({
    zones: ambientZones,
    ambientGatewayFactory: () => new HomeAssistantAmbientSensorGateway({
      haGateway: homeAutomationAdapters.haGateway,
      logger: rootLogger.child({ module: 'ambient-light-source' }),
    }),
    publicationsFactory: (zone) => new EventBusAmbientLightPublications({
      eventBus,
      channel: zone.topic,
    }),
    clock: { now: () => Date.now() },
    logger: rootLogger.child({ module: 'ambient-light' }),
  });
  server?.once?.('close', () => runningAmbientZones.forEach((service) => service.stop()));


}
