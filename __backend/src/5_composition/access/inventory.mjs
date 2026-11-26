import { DataService } from '#adapters/persistence/files/DataService.mjs';
import { LogStoreRequestObservationSource } from '#adapters/auth/LogStoreRequestObservationSource.mjs';
import { readAccessInventoryEvidence } from '#adapters/auth/ReadOnlyAccessInventoryEvidence.mjs';
import { AccessInventory } from '#apps/auth/AccessInventory.mjs';

export function createAccessInventory({ configService, logStoreUrl, fetchImpl, evidencePath }) {
  const dataService = new DataService({ configService });
  const observationSource = new LogStoreRequestObservationSource({ baseUrl: logStoreUrl, fetchImpl });
  const registrationSource = {
    async read() {
      const evidence = readAccessInventoryEvidence(evidencePath);
      const devices = [];
      const callers = [];
      for (const householdId of configService.getAllHouseholdIds()) {
        const registry = configService.getHouseholdDevices(householdId)?.devices ?? {};
        for (const id of Object.keys(registry)) devices.push({ householdId, id });

        for (const id of Object.keys(configService.getHouseholdIntegrations(householdId))) {
          callers.push({ householdId, id, kind: 'integration', transport: 'provider', provisioningOwner: 'household-admin' });
        }
      }
      const bots = configService.getSystemConfig('bots');
      for (const [app, platforms] of Object.entries(bots ?? {})) {
        for (const [transport, bot] of Object.entries(platforms ?? {})) {
          if (!bot || typeof bot !== 'object' || bot.enabled === false) continue;
          callers.push({ id: app, kind: 'bot', transport, provisioningOwner: 'local-operator' });
        }
      }
      const jobs = dataService.system.read('config/jobs');
      for (const job of Array.isArray(jobs) ? jobs : []) {
        const id = job?.id ?? job?.name;
        if (id && job.enabled !== false) callers.push({ id, kind: 'job', transport: 'scheduler', provisioningOwner: 'local-operator' });
      }
      for (const row of evidence.callers ?? []) {
        const { householdId = null, id, kind, transport, host, identifiesBy, credentialStore, provisioningOwner } = row;
        if (![id, kind, transport, identifiesBy, credentialStore, provisioningOwner].every(value => typeof value === 'string' && value)) {
          throw new Error('An inventory caller requires its identity, transport, credential store and provisioning owner');
        }
        callers.push({ householdId, id, kind, transport, host, identifiesBy, credentialStore, provisioningOwner });
      }
      return {
        domainMapping: dataService.system.read('config/domains')?.domain_mapping ?? {},
        devices, callers, activities: evidence.activities ?? [],
      };
    },
  };
  return new AccessInventory({
    registrationSource, observationSource,
    requiredActivities: ['school', 'workout', 'piano', 'film', 'phone-share'],
  });
}
