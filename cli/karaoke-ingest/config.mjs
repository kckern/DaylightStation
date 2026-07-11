import path from 'node:path';

export const MEDIA_DIR = '/media/kckern/Media/Slow TV/Karaoke';
export const SHOW_NAME = 'Karaoke';
export const SETLIST_PATH = path.join(MEDIA_DIR, 'setlist.tsv');
export const CANDIDATES_PATH = path.join(MEDIA_DIR, 'candidates.tsv');

// Season table. `seedCategories` are case-insensitive substrings matched
// (in array order) against the freeform seed "Category / Vibe" column.
export const SEASONS = [
  { number: 1, name: 'Crooners & Standards',       seedCategories: ['theatrical crooner', 'sophisticated crooner', 'timeless romance'] },
  { number: 2, name: 'Piano Men',                   seedCategories: ['piano rock master'] },
  { number: 3, name: 'Stage & Screen',              seedCategories: ['musical theater epic', 'disney renaissance'] },
  { number: 4, name: 'Emotional Ballads',           seedCategories: ['deep emotional ballad'] },
  { number: 5, name: 'Arena Power Ballads',         seedCategories: ['arena rock power ballad'] },
  { number: 6, name: 'Epic Anthems',                seedCategories: ['theatrical rock epic', 'dynamic epic climax'] },
  { number: 7, name: 'Anthems of Hope',             seedCategories: ['resilience anthem'] },
  { number: 8, name: 'Sing-Along Crowd-Pleasers',   seedCategories: ['pub / tavern essential', 'pub'] },
  { number: 9, name: 'Pop Throwbacks',              seedCategories: [] },
];

export function seasonName(n) {
  const s = SEASONS.find((x) => x.number === Number(n));
  return s ? s.name : `Season ${n}`;
}

// Returns the season number whose seedCategories first substring-match the
// given freeform category, or null if none match.
export function resolveSeason(categoryStr) {
  const c = String(categoryStr || '').toLowerCase();
  for (const s of SEASONS) {
    if (s.seedCategories.some((cat) => c.includes(cat))) return s.number;
  }
  return null;
}

// Ranking / matching knobs.
export const KARAOKE_TERMS = ['karaoke', 'instrumental', 'sing along', 'sing-along', 'backing track'];
export const REJECT_TERMS = ['reaction', 'tutorial', 'how to', 'lesson', 'cover by', 'live at', 'live in', 'concert', 'behind the scenes'];
export const CHANNEL_WEIGHTS = {
  'sing king': 1.5,
  'karafun': 1.3,
  'stingray karaoke': 1.2,
  'zzang karaoke': 1.0,
  'the karaoke channel': 1.0,
};
export const SEARCH_COUNT = 12;
export const MIN_DURATION_S = 90;    // 1.5 min
export const MAX_DURATION_S = 480;   // 8 min
export const SCORE_FLOOR = 0;        // any candidate passing hard filters is acceptable

// yt-dlp format selection: HARD-CAP height at 720p (never pull 1080p), then
// among the ≤720 renditions prefer h264/aac/mp4 at the highest available res.
export const FORMAT_FILTER = 'bv*[height<=720]+ba/b[height<=720]/b[height<=720]/b';
export const FORMAT_SORT = 'res:720,vcodec:h264,acodec:aac,ext:mp4';
export const MERGE_FORMAT = 'mp4';
