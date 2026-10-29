/**
 * Curated pages — sources whose newest item is chosen by an editor and
 * published on a web page rather than offered as a feed (e.g. PBS NewsHour
 * Classroom's Daily News Lessons, each a page embedding one YouTube segment).
 *
 * Pure parsing: no fetching here.
 */

/**
 * First link in `html` whose href matches `pattern` (a regex source for the
 * path), resolved against `baseUrl`. Query strings and fragments are dropped.
 * @returns {string|null}
 */
export function firstMatchingLink(html, pattern, baseUrl) {
  const re = new RegExp(`href=["']((?:https?://[^/"']+)?${pattern})(?:["'?#])`, 'i');
  const match = String(html || '').match(re);
  return match ? new URL(match[1], baseUrl).href : null;
}

const YOUTUBE_ID = /(?:youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?v=)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

/**
 * First YouTube video id embedded or linked in `html`.
 * @returns {string|null}
 */
export function firstYouTubeEmbedId(html) {
  const match = String(html || '').match(YOUTUBE_ID);
  return match ? match[1] : null;
}

const PUBLISHED = [
  /"datePublished"\s*:\s*"(\d{4})-(\d{2})-(\d{2})/,
  /article:published_time"\s+content="(\d{4})-(\d{2})-(\d{2})/,
];

/**
 * The page's publish date as YYYYMMDD — what a curated item is dated by.
 * @returns {string|null}
 */
export function publishedDate(html) {
  for (const re of PUBLISHED) {
    const match = String(html || '').match(re);
    if (match) return `${match[1]}${match[2]}${match[3]}`;
  }
  return null;
}
