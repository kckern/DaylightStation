/**
 * PlexLessonCaptionSource — the piano video lessons (from the household's
 * `videos.collections` tabs whose `engagement_gate` is not false) with their
 * English SRT caption stream, for the lesson-expectation build job.
 */
const bare = (id) => (id == null ? '' : String(id).replace(/^plex:/, ''));
const meta = (data) => data?.MediaContainer?.Metadata || [];

function englishSrt(item) {
  for (const media of item?.Media || []) {
    for (const part of media?.Part || []) {
      for (const s of part?.Stream || []) {
        if (Number(s.streamType) !== 3) continue;
        const codec = String(s.codec || s.format || '').toLowerCase();
        const lang = String(s.languageCode || s.languageTag || s.language || '').toLowerCase();
        if (codec === 'srt' && (lang.startsWith('en') || lang === 'english')) return String(s.id);
      }
    }
  }
  return null;
}

function hasStreams(item) {
  return (item?.Media || []).some((m) => (m?.Part || []).some((p) => Array.isArray(p?.Stream)));
}

export class PlexLessonCaptionSource {
  #client;
  #videos;
  #logger;

  constructor({ plexClient, videosConfig, logger = console }) {
    this.#client = plexClient;
    this.#videos = videosConfig || {};
    this.#logger = logger;
  }

  async #get(path) {
    return this.#client.request(path);
  }

  /**
   * The courses a tab lists: shows, or single SEASONS of a show (a collection
   * may hold a season directly — e.g. one course season of a larger show).
   * @returns {Map<key, { kind: 'show'|'season', showKey, showTitle }>}
   */
  async #unitsForTab(tab) {
    const exclude = new Set((tab.exclude_shows || []).map(bare));
    const units = new Map();
    const take = (item) => {
      const key = bare(item?.ratingKey);
      if (!key || exclude.has(key) || units.has(key)) return;
      if (item.type === 'show') units.set(key, { kind: 'show', showKey: key, showTitle: item.title ?? null });
      else if (item.type === 'season') {
        units.set(key, { kind: 'season', showKey: bare(item.parentRatingKey) || key, showTitle: item.parentTitle ?? item.title ?? null });
      }
    };
    for (const col of tab.plex || []) {
      for (const item of meta(await this.#get(`/library/collections/${bare(col)}/items`))) take(item);
    }
    for (const id of tab.shows || []) {
      const key = bare(id);
      if (exclude.has(key) || units.has(key)) continue;
      take(meta(await this.#get(`/library/metadata/${key}`))[0]);
    }
    return units;
  }

  /** @returns {Promise<Array<{ plexId, showKey, showTitle, seasonKey, season, episode, title, durationSec, captionStreamId }>>} */
  async listLessons() {
    const tabs = Array.isArray(this.#videos.collections) ? this.#videos.collections : [];
    // A gate-off tab (Voice) may cherry-pick a SEASON of a lesson show; that
    // season's episodes are not piano lessons and get no record.
    const gateOffIds = new Set(tabs.filter((t) => t?.engagement_gate === false).flatMap((t) => (t.shows || []).map(bare)));
    const units = new Map();
    for (const tab of tabs) {
      if (!tab || tab.engagement_gate === false) continue;
      for (const [k, u] of await this.#unitsForTab(tab)) if (!units.has(k)) units.set(k, u);
    }
    const lessons = [];
    const seen = new Set();
    for (const [unitKey, unit] of units) {
      const { showKey, showTitle } = unit;
      let leaves = [];
      try {
        const path = unit.kind === 'season' ? `/library/metadata/${unitKey}/children` : `/library/metadata/${unitKey}/allLeaves`;
        leaves = meta(await this.#get(path));
      } catch (err) {
        this.#logger.warn?.('piano.lesson-expectation.list-failed', { unitKey, error: err.message });
        continue;
      }
      for (const ep of leaves) {
        if (ep.parentRatingKey != null && gateOffIds.has(bare(ep.parentRatingKey))) continue;
        if (seen.has(bare(ep.ratingKey))) continue;
        seen.add(bare(ep.ratingKey));
        let item = ep;
        if (!hasStreams(ep)) {
          try { item = meta(await this.#get(`/library/metadata/${bare(ep.ratingKey)}`))[0] || ep; } catch { item = ep; }
        }
        lessons.push({
          plexId: bare(ep.ratingKey),
          showKey,
          showTitle,
          seasonKey: ep.parentRatingKey != null ? bare(ep.parentRatingKey) : null,
          season: ep.parentIndex ?? null,
          episode: ep.index ?? null,
          title: ep.title ?? null,
          durationSec: ep.duration ? Math.round(Number(ep.duration) / 1000) : null,
          captionStreamId: englishSrt(item),
        });
      }
    }
    return lessons;
  }

  /** The SRT body of a caption stream. */
  async captionText(streamId) {
    const data = await this.#get(`/library/streams/${bare(streamId)}`);
    return typeof data === 'string' ? data : (data == null ? '' : String(data));
  }
}

export default PlexLessonCaptionSource;
