export class ImmichThumbnailSource {
  constructor({ host, apiKey, httpClient } = {}) {
    this.host = host?.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.httpClient = httpClient;
  }
  fetchBytes = async (assetId) => {
    const response = await this.httpClient.get(
      `${this.host}/api/assets/${assetId}/thumbnail?size=preview`,
      { headers: { 'x-api-key': this.apiKey }, responseType: 'arraybuffer' },
    );
    return Buffer.from(response.data);
  };
}
