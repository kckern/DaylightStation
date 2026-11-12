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

  async #showsForTab(tab) {
    const exclude = new Set((tab.exclude_shows || []).map(bare));
    const shows = new Map();
    for (const col of tab.plex || []) {
      for (const item of meta(await this.#get(`/library/collections/${bare(col)}/items`))) {
        if (item.type === 'show' && !exclude.has(bare(item.ratingKey))) shows.set(bare(item.ratingKey), item.title ?? null);
      }
    }
    for (const id of tab.shows || []) {
      const key = bare(id);
      if (exclude.has(key) || shows.has(key)) continue;
      const item = meta(await this.#get(`/library/metadata/${key}`))[0];
      if (item?.type === 'show') shows.set(key, item.title ?? null);
    }
    return shows;
  }

  /** @returns {Promise<Array<{ plexId, showKey, showTitle, seasonKey, season, episode, title, durationSec, captionStreamId }>>} */
  async listLessons() {
    const tabs = Array.isArray(this.#videos.collections) ? this.#videos.collections : [];
    // A gate-off tab (Voice) may cherry-pick a SEASON of a lesson show; that
    // season's episodes are not piano lessons and get no record.
    const gateOffIds = new Set(tabs.filter((t) => t?.engagement_gate === false).flatMap((t) => (t.shows || []).map(bare)));
    const shows = new Map();
    for (const tab of tabs) {
      if (!tab || tab.engagement_gate === false) continue;
      for (const [k, t] of await this.#showsForTab(tab)) if (!shows.has(k)) shows.set(k, t);
    }
    const lessons = [];
    for (const [showKey, showTitle] of shows) {
      let leaves = [];
      try {
        leaves = meta(await this.#get(`/library/metadata/${showKey}/allLeaves`));
      } catch (err) {
        this.#logger.warn?.('piano.lesson-expectation.list-failed', { showKey, error: err.message });
        continue;
      }
      for (const ep of leaves) {
        if (ep.parentRatingKey != null && gateOffIds.has(bare(ep.parentRatingKey))) continue;
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
