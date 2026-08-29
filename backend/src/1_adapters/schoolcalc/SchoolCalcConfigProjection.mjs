import path from 'node:path';

const SERVICE = 'ticalc-relay';
const RELAY_HINT = `configure school.schoolcalc.ingress.relay_ids and household auth '${SERVICE}.relays'`;
const present = (value) => typeof value === 'string' && value.trim().length > 0;

/** Translates SchoolCalc config/auth/storage layout into a runtime projection. */
export class SchoolCalcConfigProjection {
  constructor({ configService, householdId = null } = {}) {
    if (!configService?.getHouseholdAppConfig || !configService?.getDataDir
      || !configService?.getHouseholdAppPath || !configService?.getHouseholdAuth) {
      throw new Error('SchoolCalcConfigProjection requires configService');
    }
    this.configService = configService;
    this.householdId = householdId;
  }

  read() {
    const productConfig = this.configService.getHouseholdAppConfig(this.householdId, 'school')?.schoolcalc ?? null;
    if (!productConfig || productConfig.enabled !== true) {
      return { enabled: false, reason: 'school.yml schoolcalc.enabled is not true', relayCredentials: [], actionTokenKey: null, relayConfigurationHint: RELAY_HINT };
    }
    const dataDirectory = this.configService.getDataDir();
    const stateRoot = productConfig.state?.root
      ? this.#resolve(dataDirectory, productConfig.state.root)
      : path.resolve(this.configService.getHouseholdAppPath('schoolcalc', '', this.householdId));
    return {
      enabled: true,
      productConfig,
      stateRoot,
      relayCredentials: this.#relayCredentials(productConfig),
      actionTokenKey: this.#actionTokenKey(),
      relayConfigurationHint: RELAY_HINT,
    };
  }

  view() {
    try {
      const projected = this.read();
      return {
        enabled: projected.enabled,
        relayIds: projected.relayCredentials.map(({ relayId }) => relayId),
        actionTokensConfigured: Boolean(projected.actionTokenKey),
      };
    } catch {
      const productConfig = this.configService.getHouseholdAppConfig(this.householdId, 'school')?.schoolcalc ?? null;
      return { enabled: productConfig?.enabled === true, relayIds: [], actionTokensConfigured: false };
    }
  }

  #actionTokenKey() {
    const value = this.configService.getHouseholdAuth('schoolcalc', this.householdId)?.action_token_key ?? null;
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') < 32) {
      throw new Error("Household auth 'schoolcalc.action_token_key' must contain at least 32 bytes");
    }
    return value;
  }

  #relayCredentials(productConfig) {
    const relayIds = productConfig.ingress?.relay_ids;
    if (relayIds === undefined) return [];
    if (!Array.isArray(relayIds) || relayIds.length === 0 || !relayIds.every(present)
      || new Set(relayIds).size !== relayIds.length) {
      throw new Error('schoolcalc.ingress.relay_ids must contain unique non-empty relay IDs');
    }
    const relays = this.configService.getHouseholdAuth(SERVICE, this.householdId)?.relays;
    if (!relays || typeof relays !== 'object' || Array.isArray(relays)) {
      throw new Error(`Household auth '${SERVICE}.relays' is required for SchoolCalc ingress`);
    }
    return relayIds.map((relayId) => ({ relayId, apiToken: relays[relayId]?.api_token }));
  }

  #resolve(dataDirectory, value) {
    if (!present(value)) throw new Error('SchoolCalc path must be a non-empty string');
    return path.resolve(dataDirectory, value);
  }
}

export const schoolCalcConfigurationView = ({ configService, householdId = null } = {}) =>
  new SchoolCalcConfigProjection({ configService, householdId }).view();
