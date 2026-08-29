export class IMediaSourceCatalog {
  /** Return provider-neutral configured sources with an opaque sourceRef. */
  async list() { throw new Error('IMediaSourceCatalog.list must be implemented'); }
}
