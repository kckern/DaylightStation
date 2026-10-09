import { IStreamResolver } from "../../../application/ports/IStreamResolver.mjs";
import { StreamResult } from "../../../../../content-catalog/server/stream-result.mjs";

export class YtDlpStreamResolver extends IStreamResolver {
  #probe; #logger;
  constructor({ probe, ytDlpAdapter, logger = console } = {}) {
    super();
    this.#logger = logger;
    this.#probe = probe || (async (url, opts) => ytDlpAdapter.probe(url, opts));
  }
  get strategy() { return 'ytdlp'; }

  async resolve(url, profile) {
    let info;
    try { info = await this.#probe(url, profile?.raw?.ytdlp); }
    catch (e) { this.#logger.warn?.('stream.ytdlp.probe_failed', { url, error: e.message }); return null; }
    if (!info?.url) return null;
    const isHls = /m3u8/i.test(info.protocol || '') || /\.m3u8(\?|#|\/|$)/i.test(info.url);
    return new StreamResult({
      format: isHls ? 'hls_video' : 'video',
      mediaUrl: info.url,
      title: info.title ?? null,
      duration: info.duration ?? null,
      poster: info.thumbnail ?? null,
    });
  }
}
