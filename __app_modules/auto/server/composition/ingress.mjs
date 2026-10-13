import { createAutomotiveRelay } from "../application/ingress/automotiveRelay.mjs";
import { AutomotiveFirmwareGateway } from "#adapters/hardware/firmware/EventBusFirmwareRelayGateways.mjs";
import { YamlAutomotiveTripStore } from "../adapters/ingress/YamlAutomotiveTripStore.mjs";

export function installAutomotiveRelay({ eventBus, vehiclesRelayConfig, configService, householdId, relayHistoryRoot, relayDayLog, rootLogger }) {
createAutomotiveRelay({
    relayGateway: new AutomotiveFirmwareGateway({
      eventBus,
      config: vehiclesRelayConfig,
      timezone: configService.getHouseholdTimezone(householdId),
    }),
    tripStore: new YamlAutomotiveTripStore({
      root: relayHistoryRoot(vehiclesRelayConfig, 'automotive/log'),
    }),
    dayLog: relayDayLog(vehiclesRelayConfig, 'automotive/log', 'automotive'),
    // Threaded, not read from a config singleton inside the relay — day keys and
    // trip filenames must follow the household's zone, not UTC or DEFAULT_TIMEZONE.
    timezone: configService.getHouseholdTimezone(householdId),
    logger: rootLogger.child({ module: 'obd-relay' }),
  });
}
