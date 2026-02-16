/**
 * RssHeadlineHarvester
 *
 * Fetches RSS feeds and extracts lightweight headline data.
 *
 * @module adapters/feed
 */

export class RssHeadlineHarvester {
  #rssParser;
  #logger;

  constructor({ rssParser, logger = console }) {
    this.#rssParser = rssParser;
    this.#logger = logger;
  }

  async harvest(source) {
    try {
      const feed = await this.#rssParser.parseURL(source.url);
      const items = feed.items.map(item => ({
        title: item.title,
        desc: this.#extractDesc(item),
        link: item.link,
        timestamp: this.#parseDate(item),
      }));

      this.#logger.debug?.('headline.harvest.success', { source: source.id, count: items.length });
      return { source: source.id, label: source.label, lastHarvest: new Date().toISOString(), items };
    } catch (error) {
      this.#logger.error?.('headline.harvest.error', { source: source.id, url: source.url, error: error.message });
      return { source: source.id, label: source.label, lastHarvest: new Date().toISOString(), items: [], error: error.message };
    }
  }

  #parseDate(item) {
    // Prefer rss-parser's pre-parsed ISO date
    if (item.isoDate) return item.isoDate;
    // Try native Date parsing
    if (item.pubDate) {
      const d = new Date(item.pubDate);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
    return new Date().toISOString();
  }

  #extractDesc(item) {
    const raw = item.contentSnippet || this.#stripHtml(item.content) || null;
    if (!raw) return null;
    const trimmed = raw.trim();
    if (trimmed.length <= 120) return trimmed;
    return trimmed.substring(0, 120) + '...';
  }

  #stripHtml(html) {
    if (!html) return null;
    return html.replace(/<[^>]*>/g, '').trim();
  }
}

export default RssHeadlineHarvester;
