/** Video collection → series → season → episode School-material projection. */
const SOURCE = 'media-series';

export class MediaSeriesSource {
  #mediaCatalog;

  constructor({ mediaCatalog } = {}) {
    if (!mediaCatalog) throw new Error('MediaSeriesSource requires mediaCatalog');
    this.#mediaCatalog = mediaCatalog;
  }

  async listMaterials(rootReference) {
    const series = await this.#mediaCatalog.listChildren(rootReference);
    return series.map((item) => ({
      id: item.id,
      title: item.title,
      poster: item.poster ?? null,
      summary: item.summary ?? null,
      source: SOURCE,
      medium: 'video',
      durationMs: null,
      unitCount: item.childCount ?? null,
    }));
  }

  async getMaterial(materialId) {
    const topChildren = await this.#mediaCatalog.listChildren(materialId);
    const seasons = topChildren.filter((item) => item.kind === 'season');
    const episodeLists = seasons.length
      ? await Promise.all(seasons.map((season) => this.#mediaCatalog.listChildren(season.id)))
      : [topChildren];
    const episodes = episodeLists.flat();
    const units = episodes.map((episode, index) => ({
      id: episode.id,
      index: index + 1,
      title: episode.title,
      durationMs: episode.durationMs ?? null,
      group: episode.parent?.title ?? null,
      thumb: episode.poster ?? null,
    }));
    return {
      id: this.#mediaCatalog.canonicalId(materialId),
      title: episodes[0]?.seriesTitle ?? null,
      poster: null,
      source: SOURCE,
      medium: 'video',
      durationMs: units.reduce((sum, unit) => sum + (unit.durationMs ?? 0), 0),
      unitCount: units.length,
      units,
    };
  }
}

export default MediaSeriesSource;
