/** Plex-client projection for MediaMemoryValidatorService. */
export class PlexMemoryValidationGateway {
  constructor({ client } = {}) {
    if (!client?.getLibrarySections || !client?.getMetadata || !client?.hubSearch) {
      throw new TypeError('PlexMemoryValidationGateway requires a Plex client');
    }
    this.client = client;
  }

  async checkConnectivity() {
    try {
      await this.client.getLibrarySections();
      return true;
    } catch {
      return false;
    }
  }

  async verifyId(id) {
    try {
      const response = await this.client.getMetadata(id);
      return Boolean(response?.MediaContainer?.Metadata?.length);
    } catch (error) {
      if (error?.status === 404) return false;
      throw error;
    }
  }

  hubSearch(query, libraryId) {
    return this.client.hubSearch(query, { libraryId });
  }
}

export default PlexMemoryValidationGateway;
