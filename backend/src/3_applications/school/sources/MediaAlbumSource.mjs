/** Audio collection → album/work → track/chapter School-material projection. */
const SOURCE = 'media-album';

export class MediaAlbumSource {
  #mediaCatalog;

  constructor({ mediaCatalog } = {}) {
    if (!mediaCatalog) throw new Error('MediaAlbumSource requires mediaCatalog');
    this.#mediaCatalog = mediaCatalog;
  }

  async listMaterials(rootReference) {
    const albums = await this.#mediaCatalog.listChildren(rootReference);
    const first = albums[0] ?? {};
    return [{
      id: this.#mediaCatalog.canonicalId(rootReference),
      title: first.parent?.title ?? null,
      poster: first.parent?.poster ?? first.poster ?? null,
      source: SOURCE,
      medium: 'audio',
      kind: 'collection',
      durationMs: null,
      unitCount: albums.length,
    }];
  }

  async listWorks(rootReference) {
    const albums = await this.#mediaCatalog.listChildren(rootReference);
    return albums.map((album) => ({
      id: album.id,
      title: album.title,
      poster: album.poster ?? null,
      summary: album.summary ?? null,
      source: SOURCE,
      medium: 'audio',
      kind: 'work',
      durationMs: null,
      unitCount: album.childCount ?? null,
    }));
  }

  async getMaterial(materialId) {
    const tracks = await this.#mediaCatalog.listChildren(materialId);
    const units = tracks.map((track, index) => ({
      id: track.id,
      index: track.index ?? index + 1,
      title: track.title,
      durationMs: track.durationMs ?? null,
      group: null,
    }));
    // Two-level material (an artist/collection whose children are ALBUMS):
    // the units are whole WORKS, but quiz banks backlink the works' TRACKS.
    // One batched leaf listing exposes every track's parent, so the quiz gate
    // can roll chapter banks up to their unit (Blocker 2) — never a
    // per-album fetch. Leaf children (a single album's tracks) need no map.
    let trackParents = null;
    if (tracks.some((child) => child.kind === 'album')) {
      const leaves = await this.#mediaCatalog.listLeaves(materialId);
      const map = new Map();
      for (const leaf of leaves) {
        if (leaf.parentId) map.set(leaf.id, leaf.parentId);
      }
      if (map.size > 0) trackParents = map;
    }
    const first = tracks[0] ?? {};
    return {
      id: this.#mediaCatalog.canonicalId(materialId),
      title: first.parent?.title ?? null,
      poster: first.parent?.poster ?? null,
      source: SOURCE,
      medium: 'audio',
      durationMs: units.reduce((sum, unit) => sum + (unit.durationMs ?? 0), 0),
      unitCount: units.length,
      units,
      ...(trackParents ? { trackParents } : {}),
    };
  }
}

export default MediaAlbumSource;
