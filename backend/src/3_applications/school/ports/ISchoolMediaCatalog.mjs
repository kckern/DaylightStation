/**
 * Provider-neutral read port for media used as School material.
 *
 * A node has an opaque `id`, `kind`, `medium`, display metadata, duration,
 * ordering, labels, and optional parent context. Any remote or local media
 * index may implement this port in `1_adapters`.
 */
export class ISchoolMediaCatalog {
  /** Convert a configured provider reference to its opaque canonical ID. */
  canonicalId(reference) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolMediaCatalog.canonicalId must be implemented');
  }

  /** @returns {Promise<object[]>} neutral direct children */
  async listChildren(reference) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolMediaCatalog.listChildren must be implemented');
  }

  /**
   * Every LEAF descendant (track/episode) of a container, each carrying
   * `parentId` — one batched provider call, so a two-level material can map
   * its chapters to their parent work without per-child fetches.
   * @returns {Promise<object[]>} neutral leaf nodes
   */
  async listLeaves(reference) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolMediaCatalog.listLeaves must be implemented');
  }

  /** @returns {Promise<object[]>} neutral nodes carrying `label` */
  async listTagged(libraryReference, label) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolMediaCatalog.listTagged must be implemented');
  }

  /** @returns {Promise<object|null>} one neutral node */
  async getItem(reference) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolMediaCatalog.getItem must be implemented');
  }
}

export default ISchoolMediaCatalog;
