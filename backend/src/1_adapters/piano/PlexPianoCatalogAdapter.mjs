/** Piano-facing Plex projection with collection semantics and app-proxied artwork. */
export class PlexPianoCatalogAdapter {
  constructor({ plex }) { this.plex = plex; }

  async children(ratingKey) {
    if (!this.plex?.client) return [];
    const data = await this.plex.client.getContainer(`/library/collections/${ratingKey}/items`);
    return (data?.MediaContainer?.Metadata || []).map((item) => this.#project(item));
  }

  async metadata(ratingKey) {
    if (!this.plex?.client) return null;
    const data = await this.plex.client.getContainer(`/library/metadata/${ratingKey}`);
    const item = data?.MediaContainer?.Metadata?.[0];
    return item ? this.#project(item) : null;
  }

  #project(item) {
    const projected = { ...item };
    if (typeof projected.thumb === 'string' && projected.thumb.startsWith('/')) {
      projected.thumb = `${this.plex.proxyPath}${projected.thumb}`;
    }
    return projected;
  }
}

export default PlexPianoCatalogAdapter;
