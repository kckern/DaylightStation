/**
 * Semantic persistence boundary for the admin configuration use cases.
 *
 * Callers address configuration concepts (household, scheduler, integrations,
 * editor documents), never host paths or filesystem primitives.
 */
export class IAdminConfigStore {
  listManagedAppConfigs() { throw new Error('Not implemented'); }
  readManagedAppConfig(_appId) { throw new Error('Not implemented'); }
  writeManagedAppConfig(_appId, _content) { throw new Error('Not implemented'); }
  listEditableDocuments() { throw new Error('Not implemented'); }
  readEditableDocument(_documentId) { throw new Error('Not implemented'); }
  writeEditableDocument(_documentId, _content) { throw new Error('Not implemented'); }

  readHousehold() { throw new Error('Not implemented'); }
  writeHousehold(_household) { throw new Error('Not implemented'); }
  readMemberProfile(_username) { throw new Error('Not implemented'); }
  writeMemberProfile(_username, _profile) { throw new Error('Not implemented'); }
  readMemberLogin(_username) { throw new Error('Not implemented'); }
  readDevices() { throw new Error('Not implemented'); }
  writeDevices(_devices) { throw new Error('Not implemented'); }

  readIntegrations() { throw new Error('Not implemented'); }
  readServices() { throw new Error('Not implemented'); }
  getProviderAuthLocations(_provider) { throw new Error('Not implemented'); }

  readScheduledJobs() { throw new Error('Not implemented'); }
  writeScheduledJobs(_jobs) { throw new Error('Not implemented'); }
  readSchedulerRuntime() { throw new Error('Not implemented'); }
}

export default IAdminConfigStore;
