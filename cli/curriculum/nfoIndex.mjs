// cli/curriculum/nfoIndex.mjs — pure NFO parsing + index building (no I/O).
const GENERIC = new Set(['Music', 'Educational']);

const unesc = (s) => (s == null ? s : s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"'));

const one = (xml, el) => {
  const m = xml.match(new RegExp(`<${el}>([\\s\\S]*?)</${el}>`));
  return m ? unesc(m[1].trim()) : null;
};
const tagValues = (xml, key) => {
  const re = new RegExp(`<tag>${key}:\\s*([^<]+)</tag>`, 'g');
  const out = []; let m;
  while ((m = re.exec(xml))) out.push(unesc(m[1].trim()));
  return out;
};

export function parseEpisodeNfo(xml) {
  const season = one(xml, 'season'); const episode = one(xml, 'episode');
  if (season == null || episode == null) return null;
  const genres = [...xml.matchAll(/<genre>([^<]+)<\/genre>/g)].map((m) => m[1].trim());
  const style = genres.find((g) => !GENERIC.has(g)) || null;
  const ep = {
    season: Number(season), episode: Number(episode),
    title: one(xml, 'title'), plot: one(xml, 'plot'),
    course: tagValues(xml, 'Course')[0] || null,
    style: unesc(style),
    skill: tagValues(xml, 'Skill Level')[0] || null,
    focus: tagValues(xml, 'Focus'),
    type: tagValues(xml, 'Type')[0] || null,
    instructor: one(xml, 'credits'),
  };
  // Drop empty/nullish fields (keep season/episode).
  for (const k of Object.keys(ep)) {
    if (k === 'season' || k === 'episode') continue;
    const v = ep[k];
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) delete ep[k];
  }
  return ep;
}

export function parseSeasonNfo(xml) {
  const n = one(xml, 'seasonnumber');
  return { season: n == null ? null : Number(n), title: one(xml, 'title') };
}

export function buildIndex({ show, seasonMeta = {}, episodes = [] }) {
  const eps = {}; const counts = {};
  for (const ep of episodes) {
    if (!ep) continue;
    eps[`${ep.season}:${ep.episode}`] = ep;
    counts[ep.season] = (counts[ep.season] || 0) + 1;
  }
  const seasons = {};
  for (const [sn, meta] of Object.entries(seasonMeta)) {
    seasons[sn] = { ...meta, episodes: counts[sn] || 0 };
  }
  return { show, seasons, episodes: eps };
}
