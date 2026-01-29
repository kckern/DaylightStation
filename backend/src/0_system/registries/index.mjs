// backend/src/0_system/registries/index.mjs

export { AdapterRegistry } from './AdapterRegistry.mjs';
export { HouseholdAdapters } from './HouseholdAdapters.mjs';
export { IntegrationLoader } from './IntegrationLoader.mjs';
export { SystemBotLoader } from './SystemBotLoader.mjs';
export {
  parseIntegrationsConfig,
  parseAppRouting,
  PROVIDER_CAPABILITY_MAP,
  CAPABILITY_KEYS,
} from './integrationConfigParser.mjs';
export * from './noops/index.mjs';
