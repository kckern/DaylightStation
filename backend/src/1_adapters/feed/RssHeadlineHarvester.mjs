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
    const urls = source.urls || (source.url ? [source.url] : []);
    if (urls.length === 0) {
      return { source: source.id, label: source.label, lastHarvest: new Date().toISOString(), items: [], error: 'No URL configured' };
    }

    try {
      const allItems = [];
      const errors = [];

      for (const url of urls) {
        try {
          const feed = await this.#rssParser.parseURL(url);
          for (const item of feed.items) {
            const entry = {
              title: item.title?.trim(),
              desc: this.#extractDesc(item),
              link: item.link?.trim(),
              timestamp: this.#parseDate(item),
            };
            const image = this.#extractImage(item);
            if (image) entry.image = image;
            allItems.push(entry);
          }
        } catch (err) {
          errors.push(`${url}: ${err.message}`);
          this.#logger.warn?.('headline.harvest.url.error', { source: source.id, url, error: err.message });
        }
      }

      // Sort compound feeds by timestamp descending
      if (urls.length > 1) {
        allItems.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      }

      this.#logger.debug?.('headline.harvest.success', { source: source.id, count: allItems.length, urls: urls.length });
      const result = { source: source.id, label: source.label, lastHarvest: new Date().toISOString(), items: allItems };
      if (errors.length > 0 && allItems.length === 0) result.error = errors.join('; ');
      return result;
    } catch (error) {
      this.#logger.error?.('headline.harvest.error', { source: source.id, error: error.message });
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
    const cleaned = this.#cleanDesc(raw);
    if (!cleaned) return null;
    if (cleaned.length <= 120) return cleaned;
    return cleaned.substring(0, 120) + '...';
  }

  #cleanDesc(text) {
    return text
      // Remove Tailwind bracket-notation class artifacts (e.g. [&>:first-child]:h-full)
      .replace(/\[&[^\]]*\]:\S*/g, '')
      // Remove stray HTML attribute fragments (e.g. closing "> from broken tag stripping)
      .replace(/\s*">\s*/g, ' ')
      // Remove Reddit boilerplate
      .replace(/submitted\s+by\s+\/u\/\S+/gi, '')
      .replace(/\[link\]\s*\[comments\]/gi, '')
      // Collapse whitespace
      .replace(/\s+/g, ' ')
      .trim();
  }

  #extractImage(item) {
    // media:content (array of { $: { url, type } })
    const mediaContent = item['media:content'];
    if (Array.isArray(mediaContent)) {
      const img = mediaContent.find(m => m?.['$']?.type?.startsWith('image/') || m?.['$']?.url);
      if (img?.['$']?.url) return img['$'].url;
    }
    // media:thumbnail
    const thumb = item['media:thumbnail'];
    if (thumb?.['$']?.url) return thumb['$'].url;
    // enclosure
    if (item.enclosure?.url && item.enclosure?.type?.startsWith('image/')) return item.enclosure.url;
    return null;
  }

  #stripHtml(html) {
    if (!html) return null;
    // Handle > inside quoted attributes (e.g. Tailwind classes like [&>:first-child])
    return html
      .replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

export default RssHeadlineHarvester;
