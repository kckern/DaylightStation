#!/usr/bin/env node

/**
 * Content Filter CLI - lookup filter data ("tag sets") and export normalized EDLs
 *
 * VidAngel publishes per-title filter data: a tree of categories
 * (language/profanity/f-word, violence/graphic, sex_nudity/immodesty, ...)
 * whose leaf "tags" carry a type + approximate start/end seconds:
 *   - type: audio       -> mute the word  (point event, start==end)
 *   - type: audiovisual -> skip the segment
 * There is NO spatial/region data (no censor-bar coords) — visual concerns are
 * skipped, never blurred.
 *
 * IMPORTANT — precision: VidAngel timestamps are integer-SECOND "approx" values
 * keyed to VidAngel's own source recording, NOT your local file. Treat the
 * export as a COARSE FIRST PASS / locator: a millisecond-accurate mute/bleep
 * needs a local refinement pass (subtitle snap or Whisper forced-alignment in a
 * small window around each tag). See `docs/plans/*content-filter*`.
 *
 * Usage:
 *   node contentfilter.cli.mjs <command> [options]
 *
 * Commands:
 *   search <query>          Find filterable titles (slug, year, type, tag_count)
 *   works                   Popular filterable titles available on your services
 *   tags <slug|workId>      Summarize a title's filter categories + tag counts
 *   export <slug|workId>    Emit a normalized FilterEDL (YAML) to stdout
 *   match [--section <id>]  Cross-reference your Plex movie library vs VidAngel
 *
 * Options:
 *   --json                  Output raw JSON instead of formatted text
 *   --limit <n>             Cap results (search/works/match), default 100
 *   --out <path>            (export) write to file instead of stdout
 *   --section <id>          (match) Plex movie section id (default: all movie libs)
 *
 * Auth: reads data/household/auth/vidangel.yml ({ token, profile }) from the
 * data dir resolved via DAYLIGHT_BASE_PATH in .env. Override with
 * VIDANGEL_TOKEN / VIDANGEL_PROFILE env vars. Plex match reuses
 * data/household/auth/plex.yml + services.yml (or PLEX_TOKEN/PLEX_HOST).
 *
 * @module cli/contentfilter
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { hostname } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import axios from 'axios';

const VA_BASE = 'https://api.vidangel.com';

// ============================================================================
// Config
// ============================================================================

/** Resolve the data dir the app uses (DAYLIGHT_BASE_PATH/data). */
function resolveDataDir() {
  if (process.env.DAYLIGHT_DATA_DIR) return process.env.DAYLIGHT_DATA_DIR;
  let base = process.env.DAYLIGHT_BASE_PATH;
  if (!base) {
    // Fall back to .env in the repo root (cli/ -> repo root)
    const envPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '.env');
    if (existsSync(envPath)) {
      const line = readFileSync(envPath, 'utf8')
        .split('\n')
        .find((l) => l.startsWith('DAYLIGHT_BASE_PATH='));
      if (line) base = line.slice('DAYLIGHT_BASE_PATH='.length).trim();
    }
  }
  if (!base) {
    console.error('Error: set DAYLIGHT_BASE_PATH (in .env or env) or DAYLIGHT_DATA_DIR.');
    process.exit(1);
  }
  return path.join(base, 'data');
}

function loadYaml(p) {
  try {
    return yaml.load(readFileSync(p, 'utf8')) || {};
  } catch {
    return null;
  }
}

/** Cache dir for content-filter artifacts (catalog dump, plex->VA map). */
function filterCacheDir() {
  return path.join(resolveDataDir(), 'household', 'shared', 'content-filter');
}
const CATALOG_PATH = () => path.join(filterCacheDir(), 'vidangel-catalog.json');
const MAP_PATH = () => path.join(filterCacheDir(), 'plex-vidangel-map.yml');

/** Normalize a title for collision-tolerant matching. */
function normTitle(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function loadVidAngelAuth() {
  const token = process.env.VIDANGEL_TOKEN;
  const profile = process.env.VIDANGEL_PROFILE;
  if (token) return { token, profile: profile || '' };
  const dataDir = resolveDataDir();
  const cfg = loadYaml(path.join(dataDir, 'household', 'auth', 'vidangel.yml'));
  if (!cfg?.token) {
    console.error('Error: no VidAngel token. Set VIDANGEL_TOKEN or create');
    console.error(`  ${path.join(dataDir, 'household', 'auth', 'vidangel.yml')}  ({ token, profile }).`);
    process.exit(1);
  }
  return { token: cfg.token, profile: String(cfg.profile ?? '') };
}

function loadPlexConfig() {
  const envToken = process.env.PLEX_TOKEN;
  const envHost = process.env.PLEX_HOST;
  if (envToken && envHost) return { token: envToken, host: envHost };
  const dataDir = resolveDataDir();
  let token = envToken;
  if (!token) token = loadYaml(path.join(dataDir, 'system', '..', 'household', 'auth', 'plex.yml'))?.token;
  if (!token) token = loadYaml(path.join(dataDir, 'household', 'auth', 'plex.yml'))?.token;
  let host = envHost;
  if (!host) {
    const services = loadYaml(path.join(dataDir, 'system', 'config', 'services.yml')) || {};
    const plexHosts = services.plex || {};
    host = plexHosts[hostname()] || plexHosts['kckern-macbook'] || plexHosts['kckern-server'] || plexHosts.docker;
  }
  if (!token || !host) {
    console.error('Error: could not resolve Plex token/host. Set PLEX_TOKEN and PLEX_HOST.');
    process.exit(1);
  }
  return { token, host: host.replace(/\/$/, '') };
}

// ============================================================================
// VidAngel client
// ============================================================================

class VidAngel {
  constructor({ token, profile }) {
    this.token = token;
    this.profile = profile;
  }

  headers() {
    const h = {
      accept: 'application/json, text/plain, */*',
      origin: 'https://www.vidangel.com',
      referer: 'https://www.vidangel.com/',
      'x-app-platform': 'web',
      'x-avod': 'true'
    };
    // Send auth only with a real token. A BAD/placeholder token returns 401 on
    // public endpoints (worse than no header), so omit it for unauthed sweeps.
    if (this.token && this.token !== 'public') {
      h.authorization = `Token ${this.token}`;
      if (this.profile) h['x-profile'] = this.profile;
    }
    return h;
  }

  async get(endpoint) {
    const url = endpoint.startsWith('http') ? endpoint : `${VA_BASE}${endpoint}`;
    try {
      const res = await axios.get(url, { headers: this.headers() });
      return res.data;
    } catch (err) {
      if (err.response?.status === 404) return null;
      throw new Error(`VidAngel API ${err.response?.status || ''} on ${endpoint}: ${err.message}`);
    }
  }

  /** Search -> filterable titles (the `titles` bucket: has slug + tag_count). */
  async search(query) {
    const data = await this.get(`/api/content/search/?q=${encodeURIComponent(query)}`);
    const titles = (data?.titles || []).filter((t) => t.slug);
    return titles.map((t) => ({
      id: t.id,
      title: t.title,
      year: t.year,
      type: t.type,
      slug: t.slug,
      tagCount: t.tag_count ?? 0
    }));
  }

  /**
   * Confident filterable-movie match for a title+year.
   * Requires a real normalized-title match — NO "first result" fallback (that
   * produced false positives like "1776" -> "Braveheart"). Returns null when
   * nothing genuinely matches, so `match` reports honest hit rates.
   */
  async findMovie(title, year) {
    const results = await this.search(title);
    const movies = results.filter((r) => r.type === 'movie' && r.tagCount > 0);
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const want = norm(title);
    const exact = movies.filter((m) => norm(m.title) === want);
    if (!exact.length) return null;
    if (year) {
      const byYear = exact.filter((m) => Math.abs((m.year || 0) - year) <= 1);
      if (byYear.length) return byYear[0];
      // Title matches but year is off — likely a remake; flag it as low-confidence.
      return { ...exact[0], yearMismatch: true };
    }
    return exact[0];
  }

  async works({ limit = 100 } = {}) {
    const data = await this.get(
      `/api/content/v2/works/?limit=${limit}&offset=0&order_by=-popularity&my_services=true&catalogs=1,3`
    );
    return (data?.results || []).map((r) => ({
      id: r.id, title: r.title, type: r.type, slug: r.slug, tagCount: r.tag_count ?? 0
    }));
  }

  /**
   * Page the ENTIRE filterable catalog via the public works endpoint.
   * Throttled + idempotent so we never hammer the API: one pass of ~N/100
   * requests with a polite delay. No auth, no per-title searches.
   * @param {(msg:string)=>void} onProgress
   */
  async catalogSync({ pageSize = 100, delayMs = 400, onProgress = () => {} } = {}) {
    const all = [];
    for (let offset = 0; ; offset += pageSize) {
      const data = await this.get(
        `/api/content/v2/works/?limit=${pageSize}&offset=${offset}&order_by=title`
      );
      const rows = data?.results || [];
      if (!rows.length) break;
      for (const r of rows) {
        all.push({
          id: r.id,
          title: r.title,
          type: r.type,
          slug: r.slug,
          tagCount: r.tag_count ?? 0,
          mpaa: r.mpaa_rating || null
        });
      }
      onProgress(`  fetched ${all.length} (offset ${offset})`);
      if (rows.length < pageSize) break;
      await new Promise((res) => setTimeout(res, delayMs)); // be a good citizen
    }
    return all;
  }

  /** Resolve a movie (by slug) including its offerings -> tag_set_id. */
  async movieBySlug(slug) {
    const data = await this.get(`/api/content/v2/movies/?slug=${encodeURIComponent(slug)}`);
    return data?.results?.[0] || null;
  }

  /**
   * Resolve the release year for a catalog entry (the catalog dump has no year).
   * Movies: the movies endpoint carries `year`. Shows: fall back to search and
   * match the slug. Returns null if unknown. Public — no auth required.
   */
  async yearForSlug(slug, type) {
    if (type === 'movie') {
      const m = await this.movieBySlug(slug);
      return m?.year ?? null;
    }
    // show (or unknown): search by the slug's title-ish stem and match the slug
    const titleGuess = slug.replace(/-[a-f0-9]{4,6}$/i, '').replace(/-/g, ' ');
    const data = await this.get(`/api/content/search/?q=${encodeURIComponent(titleGuess)}`);
    const hit = (data?.titles || []).find((t) => t.slug === slug);
    return hit?.year ?? null;
  }

  /** First available tag_set_id for a movie's offerings. */
  pickTagSetId(movie) {
    for (const o of movie?.offerings || []) if (o.tag_set_id) return o.tag_set_id;
    return null;
  }

  async tagSet(tagSetId) {
    return this.get(`/api/bff/tag-sets/${tagSetId}/`);
  }
}

// ============================================================================
// Normalization: VidAngel tag-set -> FilterEDL
// ============================================================================

/** Map a VidAngel category-path top segment to a coarse category bucket. */
function topCategory(catpath) {
  return (catpath.split('/')[0] || 'other');
}

/**
 * Flatten a tag-set's category tree into normalized cues.
 * - audio       -> mute  (point event widened to a small window downstream)
 * - audiovisual -> skip
 * Times are integer SECONDS, approximate (see file header).
 */
function tagSetToEdl(tagSet, { workId, slug, title, year } = {}) {
  const cues = [];
  const walk = (cats, parents) => {
    for (const c of cats || []) {
      const p = [...parents, c.key];
      for (const t of c.tags || []) {
        const isAudio = t.type === 'audio';
        cues.push({
          id: `va${t.id}`,
          type: isAudio ? 'mute' : 'skip',
          category: p.join('/'),
          group: topCategory(p.join('/')),
          in: t.start_approx,
          out: Math.max(t.end_approx, t.start_approx),
          label: t.description || c.display_title || c.key,
          source: 'vidangel',
          // honesty flag: a 0-length audio point needs local refinement
          approx: t.type === 'audio' && t.start_approx === t.end_approx
        });
      }
      walk(c.child_categories, p);
    }
  };
  walk(tagSet?.tag_categories, []);
  cues.sort((a, b) => a.in - b.in || a.out - b.out);
  return {
    contentId: null, // caller fills in (e.g. plex:<ratingKey>) when wiring to a file
    title: title || null,
    year: year || null,
    source: 'vidangel',
    sourceRef: { workId: workId ?? tagSet?.work_id ?? null, slug: slug ?? null, tagSetId: tagSet?.tag_set_id ?? null },
    runtimeUnalteredSec: tagSet?.runtime_unaltered ?? null,
    precision: 'second-approx', // NOT ms — refine locally before muting words
    cues
  };
}

function edlStats(edl) {
  const byType = {};
  const byGroup = {};
  for (const c of edl.cues) {
    byType[c.type] = (byType[c.type] || 0) + 1;
    byGroup[c.group] = (byGroup[c.group] || 0) + 1;
  }
  return { total: edl.cues.length, byType, byGroup };
}

// ============================================================================
// MCF (MovieContentFilter) <-> FilterEDL   (Layer-1 interop, WebVTT subset 1.1.0)
// Spec: https://www.moviecontentfilter.com/specification
// ============================================================================

// MCF second-level categories grouped under our top-level buckets.
const MCF_GROUPS = {
  commercial: ['commercial', 'advertBreak', 'consumerism', 'productPlacement'],
  discrimination: ['discrimination', 'adultism', 'antisemitism', 'genderism', 'homophobia',
    'misandry', 'misogyny', 'racism', 'sexism', 'supremacism', 'transphobia', 'xenophobia'],
  dispensable: ['dispensable', 'idiocy', 'tedious'],
  drugs: ['drugs', 'alcohol', 'antipsychotics', 'cigarettes', 'depressants', 'gambling',
    'hallucinogens', 'stimulants'],
  fear: ['fear', 'accident', 'acrophobia', 'aliens', 'arachnophobia', 'astraphobia', 'aviophobia',
    'chemophobia', 'claustrophobia', 'coulrophobia', 'cynophobia', 'death', 'dentophobia',
    'emetophobia', 'enochlophobia', 'explosion', 'fire', 'gerascophobia', 'ghosts', 'grave',
    'hemophobia', 'hylophobia', 'melissophobia', 'misophonia', 'musophobia', 'mysophobia',
    'nosocomephobia', 'nyctophobia', 'siderodromophobia', 'thalassophobia', 'vampires'],
  language: ['language', 'blasphemy', 'nameCalling', 'sexualDialogue', 'swearing', 'vulgarity'],
  nudity: ['nudity', 'bareButtocks', 'exposedGenitalia', 'fullNudity', 'toplessness'],
  sex: ['sex', 'adultery', 'analSex', 'coitus', 'kissing', 'masturbation', 'objectification',
    'oralSex', 'premaritalSex', 'promiscuity', 'prostitution'],
  violence: ['violence', 'choking', 'crueltyToAnimals', 'culturalViolence', 'desecration',
    'emotionalViolence', 'kicking', 'massacre', 'murder', 'punching', 'rape', 'slapping',
    'slavery', 'stabbing', 'torture', 'warfare', 'weapons']
};
const MCF_GROUP_OF = (() => {
  const m = {};
  for (const [g, leaves] of Object.entries(MCF_GROUPS)) for (const l of leaves) m[l] = g;
  return m;
})();
const MCF_SEVERITIES = new Set(['low', 'medium', 'high']);
const MCF_CHANNELS = new Set(['both', 'video', 'audio']);

// Our top-group -> nearest MCF leaf, for exporting non-MCF-origin cues.
const GROUP_TO_MCF = {
  language: 'swearing', sex_nudity: 'nudity', sex_nudity_immodesty: 'nudity',
  sex: 'sex', nudity: 'nudity', violence: 'violence', violence_blood_gore: 'violence',
  drugs: 'drugs', alcohol_or_drug_use: 'drugs', human_functions: 'vulgarity',
  credits: 'dispensable', discrimination: 'discrimination', fear: 'fear', commercial: 'commercial'
};
// VidAngel profanity leaves -> MCF language leaf.
const VA_LEAF_TO_MCF = {
  fuck: 'swearing', shit: 'swearing', ass: 'vulgarity', damn: 'swearing', hell: 'swearing',
  bitch: 'swearing', god: 'blasphemy', jesus: 'blasphemy', christ: 'blasphemy'
};

const secToVtt = (s) => {
  const ms = Math.round((s % 1) * 1000);
  const t = Math.floor(s);
  const hh = String(Math.floor(t / 3600)).padStart(2, '0');
  const mm = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
  const ss = String(t % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}.${String(ms).padStart(3, '0')}`;
};
const vttToSec = (v) => {
  const m = v.trim().match(/^(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})$/);
  if (!m) return null;
  const [, h, mm, ss, ms] = m;
  return (h ? +h * 3600 : 0) + +mm * 60 + +ss + +ms / 1000;
};

/** Parse an MCF (WebVTT subset) string into { meta, cues }. */
function parseMcf(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (!/^WEBVTT(\s+MovieContentFilter)?/.test(lines[0] || '')) {
    throw new Error('Not a WEBVTT/MCF file (missing WEBVTT header line)');
  }
  const meta = {};
  const cues = [];
  let i = 1;
  let cueIdx = 0;
  while (i < lines.length) {
    const line = lines[i];
    // metadata living in NOTE blocks: "TITLE x", "YEAR n", "TYPE movie", "START/END ts"
    const meatch = line.match(/^(TITLE|YEAR|TYPE|START|END)\s+(.+)$/);
    if (meatch) { meta[meatch[1].toLowerCase()] = meatch[2].trim(); i++; continue; }
    const tsMatch = line.match(/(\d{2}:\d{2}:\d{2}\.\d{3}|\d+:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3}|\d+:\d{2}\.\d{3})/);
    if (tsMatch) {
      const inSec = vttToSec(tsMatch[1]);
      const outSec = vttToSec(tsMatch[2]);
      i++;
      // payload lines until blank
      while (i < lines.length && lines[i].trim() !== '') {
        const payload = lines[i].trim();
        const [body, comment] = payload.split(/\s+#\s+/);
        const parts = body.split('=');
        const category = parts[0];
        const severity = parts[1];
        const channel = parts[2] || 'both';
        if (category && MCF_SEVERITIES.has(severity)) {
          const group = MCF_GROUP_OF[category] || 'other';
          const ch = MCF_CHANNELS.has(channel) ? channel : 'both';
          cues.push({
            id: `mcf${cueIdx++}`,
            type: ch === 'audio' ? 'mute' : 'skip', // action hint; profile may override
            category: `${group}/${category}`,
            group,
            channel: ch,
            severity,
            in: inSec,
            out: outSec,
            label: comment || category,
            source: 'mcf'
          });
        }
        i++;
      }
    }
    i++;
  }
  return { meta, cues };
}

function mcfToEdl({ meta, cues }, { contentId = null } = {}) {
  cues.sort((a, b) => a.in - b.in || a.out - b.out);
  return {
    contentId,
    title: meta.title || null,
    year: meta.year ? Number(meta.year) : null,
    source: 'mcf',
    precision: 'ms', // WebVTT timestamps are millisecond-accurate — no snap needed
    cues
  };
}

/** Serialize a FilterEDL (Layer 1) back to an MCF string. Best-effort vocab mapping. */
function edlToMcf(edl) {
  const out = ['WEBVTT MovieContentFilter 1.1.0', ''];
  if (edl.title || edl.year || edl.contentId) {
    out.push('NOTE');
    if (edl.title) out.push(`TITLE ${edl.title}`);
    if (edl.year) out.push(`YEAR ${edl.year}`);
    out.push('TYPE movie', '');
  }
  for (const c of edl.cues) {
    const leaf = c.category.split('/').pop();
    const mcfCat = MCF_GROUP_OF[leaf] ? leaf
      : VA_LEAF_TO_MCF[leaf] || GROUP_TO_MCF[c.group] || GROUP_TO_MCF[c.category?.split('/')[0]] || 'dispensable';
    const severity = MCF_SEVERITIES.has(c.severity) ? c.severity : 'medium';
    const channel = c.channel && MCF_CHANNELS.has(c.channel)
      ? c.channel
      : (c.type === 'mute' ? 'audio' : c.type === 'blur' ? 'video' : 'both');
    out.push(`${secToVtt(c.in)} --> ${secToVtt(Math.max(c.out, c.in + 0.001))}`);
    const comment = c.label ? ` # ${c.label}` : '';
    out.push(`${mcfCat}=${severity}=${channel}${comment}`, '');
  }
  return out.join('\n');
}

// ============================================================================
// Calibration — derive a per-title time `sync` {offsetSec, scale} that remaps
// VidAngel's (second-approx, foreign-recording) cue times onto THIS Plex file.
// Snap a sample of mute cues (whose word we know) to where the word really is,
// then robustly regress snapped-vs-EDL time. One sync fixes every cue at once;
// per-cue ms precision is a separate (Whisper) refinement.
// ============================================================================

// VidAngel category leaf -> spoken word stems (what the SRT/transcript contains).
const WORD_STEMS = {
  fuck: ['fuck', 'fuckin', 'fucking', 'fucked', 'motherfuck'],
  shit: ['shit', 'bullshit', 'shitty'],
  ass: ['ass', 'asshole', 'dumbass', 'jackass', 'badass'],
  damn: ['damn', 'dammit', 'damnit', 'goddamn'],
  hell: ['hell'],
  bitch: ['bitch'],
  god: ['god', 'goddamn', 'goddamnit'],
  jesus: ['jesus'],
  christ: ['christ'],
  bastard: ['bastard'],
};

const srtTimeToSec = (t) => {
  const m = t.trim().match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
  if (!m) return null;
  return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
};

/** Parse an SRT string into [{ start, end, text }] (tags stripped, lowercased). */
function parseSrt(text) {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n\s*\n/);
  const out = [];
  for (const b of blocks) {
    const lines = b.split('\n').filter((l) => l.trim() !== '');
    const tline = lines.find((l) => l.includes('-->'));
    if (!tline) continue;
    const [a, c] = tline.split('-->');
    const start = srtTimeToSec(a);
    const end = srtTimeToSec(c);
    if (start == null) continue;
    const body = lines.slice(lines.indexOf(tline) + 1).join(' ')
      .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').toLowerCase().trim();
    out.push({ start, end, text: body });
  }
  return out;
}

const leafOf = (category) => String(category || '').split('/').pop();
const stemsFor = (category) => WORD_STEMS[leafOf(category)] || null;
const textHasStem = (text, stems) => stems.some((s) => new RegExp(`\\b${s}`, 'i').test(text));

/**
 * Snap one mute cue to the nearest SRT line (within ±window) that contains the
 * cue's target word. Returns the line start time, or null if no match.
 */
function snapCueToSrt(cue, srt, window) {
  const stems = stemsFor(cue.category);
  if (!stems) return null;
  let best = null;
  for (const line of srt) {
    if (line.start < cue.in - window || line.start > cue.in + window) continue;
    if (!textHasStem(line.text, stems)) continue;
    const dist = Math.abs(line.start - cue.in);
    if (!best || dist < best.dist) best = { t: line.start, dist };
  }
  return best ? best.t : null;
}

/** Robust linear fit y = scale*x + offset with MAD outlier rejection. */
function robustFit(pairs) {
  const median = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    const n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  };
  let pts = pairs;
  // Offset-only robust estimate (scale locked to 1) — best for same-source rips.
  const offsets = pts.map((p) => p.y - p.x);
  const medOffset = median(offsets);
  const resid = offsets.map((o) => Math.abs(o - medOffset));
  const mad = median(resid) || 0.001;
  const kept = pts.filter((p, i) => Math.abs(offsets[i] - medOffset) <= 3 * 1.4826 * mad + 0.75);
  pts = kept.length >= 3 ? kept : pts;

  // Least-squares 2-param fit on the kept points (to detect a framerate scale).
  const n = pts.length;
  const sx = pts.reduce((a, p) => a + p.x, 0);
  const sy = pts.reduce((a, p) => a + p.y, 0);
  const sxx = pts.reduce((a, p) => a + p.x * p.x, 0);
  const sxy = pts.reduce((a, p) => a + p.x * p.y, 0);
  const denom = n * sxx - sx * sx;
  const scale = denom ? (n * sxy - sx * sy) / denom : 1;
  const offsetLS = (sy - scale * sx) / n;
  const meanY = sy / n;
  const ssTot = pts.reduce((a, p) => a + (p.y - meanY) ** 2, 0) || 1e-9;
  const ssRes = pts.reduce((a, p) => a + (p.y - (scale * p.x + offsetLS)) ** 2, 0);
  const r2 = 1 - ssRes / ssTot;

  const offsetOnly = median(pts.map((p) => p.y - p.x));
  const medAbsResid = median(pts.map((p) => Math.abs(p.y - (p.x + offsetOnly))));
  return { n, used: pts.length, total: pairs.length, scale, offsetLS, offsetOnly, r2, medAbsResid };
}

/** Whisper-snap sample cues by shelling the python aligner helper. */
function snapCuesWhisper(partUrl, samples, { window, model }) {
  const helper = path.join(path.dirname(fileURLToPath(import.meta.url)), 'contentfilter', 'align.py');
  const PY = process.env.WHISPER_PY || '/opt/homebrew/opt/python@3.11/bin/python3.11';
  const job = JSON.stringify({ partUrl, window, model, samples });
  const out = execFileSync(PY, [helper], { input: job, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' });
  return JSON.parse(out); // [{ id, edl, snapped|null }]
}

// ============================================================================
// Plex (read-only, for `match`)
// ============================================================================

/**
 * Load Plex items.
 * @param {string|null} section  one section key, or null for ALL movie+show libs
 * @param {object} [opts]
 * @param {string[]} [opts.types]  Plex section types to include (default movie+show)
 */
async function plexItems(section, { types = ['movie', 'show'] } = {}) {
  const { token, host } = loadPlexConfig();
  const fetch = async (ep) => {
    const url = `${host}/${ep}${ep.includes('?') ? '&' : '?'}X-Plex-Token=${token}`;
    const res = await axios.get(url, { headers: { Accept: 'application/json' } });
    return res.data;
  };
  const libs = (await fetch('library/sections'))?.MediaContainer?.Directory || [];
  const sections = section
    ? libs.filter((d) => String(d.key) === String(section))
    : libs.filter((d) => types.includes(d.type));
  const out = [];
  for (const lib of sections) {
    const data = await fetch(`library/sections/${lib.key}/all`);
    for (const m of data?.MediaContainer?.Metadata || []) {
      out.push({
        ratingKey: m.ratingKey,
        title: m.title,
        year: m.year,
        plexType: m.type, // movie | show
        section: lib.key,
        sectionTitle: lib.title
      });
    }
  }
  return out;
}

/**
 * Offline match: Plex items against a cached VidAngel catalog.
 * Returns { matched, ambiguous, unmatched } with confidence levels.
 * Zero VidAngel API calls.
 */
function matchOffline(plex, catalog) {
  // Index catalog by normalized title.
  const idx = new Map();
  for (const c of catalog) {
    const key = normTitle(c.title);
    if (!key) continue;
    if (!idx.has(key)) idx.set(key, []);
    idx.get(key).push(c);
  }
  const matched = [];
  const ambiguous = [];
  const unmatched = [];
  for (const p of plex) {
    const cands = idx.get(normTitle(p.title)) || [];
    if (!cands.length) { unmatched.push(p); continue; }
    // Prefer a candidate whose VidAngel type aligns with the Plex type.
    // Plex movie -> VA movie; Plex show -> VA show.
    const sameType = cands.filter((c) => c.type === p.plexType);
    const pool = sameType.length ? sameType : cands;
    // Prefer entries that actually carry filter data (movies: tagCount>0).
    const withTags = pool.filter((c) => c.tagCount > 0);
    const finalPool = withTags.length ? withTags : pool;
    if (finalPool.length === 1) {
      matched.push({ plex: p, va: finalPool[0], confidence: 'high' });
    } else {
      // Same normalized title, multiple candidates — needs year/disambiguation.
      ambiguous.push({ plex: p, candidates: finalPool });
    }
  }
  return { matched, ambiguous, unmatched };
}

// ============================================================================
// Commands
// ============================================================================

const args = process.argv.slice(2);
const flags = {
  json: args.includes('--json'),
  resolve: args.includes('--resolve'),
  limit: 100,
  out: null,
  section: null,
  delay: 500,
  'content-id': null,
  method: 'srt',
  samples: 25,
  window: 6,
  model: 'small.en'
};
const VALUE_FLAGS = {
  '--limit': 'limit', '--out': 'out', '--section': 'section', '--delay': 'delay',
  '--content-id': 'content-id', '--method': 'method', '--samples': 'samples',
  '--window': 'window', '--model': 'model', '--cover-window': 'cover-window'
};
for (const [flag, key] of Object.entries(VALUE_FLAGS)) {
  const i = args.indexOf(flag);
  if (i !== -1 && args[i + 1] !== undefined) flags[key] = args[i + 1];
}
flags.limit = Number(flags.limit) || 100;
const positional = args.filter((a, i) => !a.startsWith('--') && !Object.keys(VALUE_FLAGS).includes(args[i - 1]));
const command = positional[0];
const cmdArgs = positional.slice(1);

async function resolveTagSet(va, ref) {
  // ref may be a slug or a numeric workId-as-slug; only slug resolves offerings.
  const movie = await va.movieBySlug(ref);
  if (!movie) throw new Error(`No VidAngel movie found for slug "${ref}". Use \`search\` to find the slug.`);
  const tagSetId = va.pickTagSetId(movie);
  if (!tagSetId) {
    throw new Error(`"${movie.title}" has no tag_set on your services (it may not be filterable for your catalogs).`);
  }
  const tagSet = await va.tagSet(tagSetId);
  return { movie, tagSet };
}

async function main() {
  if (!command || ['help', '-h', '--help'].includes(command)) {
    printHelp();
    process.exit(0);
  }

  if (command === 'search' || command === 's') {
    const va = new VidAngel(loadVidAngelAuth());
    const q = cmdArgs.join(' ');
    if (!q) { console.error('Usage: vidangel search <query>'); process.exit(1); }
    const results = (await va.search(q)).slice(0, flags.limit);
    if (flags.json) { console.log(JSON.stringify(results, null, 2)); return; }
    if (!results.length) { console.log('No filterable titles found.'); return; }
    console.log(`\nFilterable matches for "${q}":\n${'='.repeat(60)}`);
    for (const r of results) {
      console.log(`  ${r.type === 'movie' ? '🎬' : '📺'} ${r.title} (${r.year ?? '?'})  tags=${r.tagCount}  slug=${r.slug}`);
    }
    console.log();
    return;
  }

  if (command === 'works') {
    const va = new VidAngel(loadVidAngelAuth());
    const results = (await va.works({ limit: flags.limit }));
    if (flags.json) { console.log(JSON.stringify(results, null, 2)); return; }
    console.log(`\nPopular filterable titles on your services (${results.length}):\n${'='.repeat(60)}`);
    for (const r of results) console.log(`  ${r.type === 'movie' ? '🎬' : '📺'} ${r.title}  tags=${r.tagCount}  slug=${r.slug ?? '-'}`);
    console.log();
    return;
  }

  if (command === 'tags') {
    const va = new VidAngel(loadVidAngelAuth());
    const ref = cmdArgs[0];
    if (!ref) { console.error('Usage: vidangel tags <slug>'); process.exit(1); }
    const { movie, tagSet } = await resolveTagSet(va, ref);
    const edl = tagSetToEdl(tagSet, { slug: ref, title: movie.title, year: movie.year });
    const stats = edlStats(edl);
    if (flags.json) { console.log(JSON.stringify({ movie: { title: movie.title, year: movie.year }, stats }, null, 2)); return; }
    console.log(`\n${movie.title} (${movie.year}) — ${stats.total} cues  [precision: ${edl.precision}]`);
    console.log(`${'='.repeat(60)}`);
    console.log(`  by type:  ${Object.entries(stats.byType).map(([k, v]) => `${k}=${v}`).join('  ')}`);
    console.log('  by group:');
    for (const [g, n] of Object.entries(stats.byGroup).sort((a, b) => b[1] - a[1])) console.log(`     ${g.padEnd(24)} ${n}`);
    console.log();
    return;
  }

  if (command === 'export') {
    const va = new VidAngel(loadVidAngelAuth());
    const ref = cmdArgs[0];
    if (!ref) { console.error('Usage: vidangel export <slug> [--out file.yml]'); process.exit(1); }
    const { movie, tagSet } = await resolveTagSet(va, ref);
    const edl = tagSetToEdl(tagSet, { slug: ref, title: movie.title, year: movie.year });
    const output = flags.json ? JSON.stringify(edl, null, 2) : yaml.dump(edl, { lineWidth: 120 });
    if (flags.out) {
      writeFileSync(flags.out, output);
      console.error(`Wrote ${edl.cues.length} cues -> ${flags.out}`);
    } else {
      console.log(output);
    }
    return;
  }

  if (command === 'bulk-export') {
    if (!existsSync(MAP_PATH())) {
      console.error('No map. Run:  node cli/contentfilter.cli.mjs catalog-sync && map --resolve');
      process.exit(1);
    }
    const va = new VidAngel(loadVidAngelAuth()); // tag-sets are token-gated
    const mapDoc = yaml.load(readFileSync(MAP_PATH(), 'utf8')) || {};
    const entries = Object.entries(mapDoc.map || {})
      .filter(([, v]) => v.plexType === 'movie' && (v.vidangel?.tagCount || 0) > 0);
    const outDir = path.join(filterCacheDir(), 'edl');
    mkdirSync(outDir, { recursive: true });
    const force = args.includes('--force');
    const delay = args.includes('--delay') ? Number(flags.delay) || 500 : 500;
    const limited = args.includes('--limit') ? entries.slice(0, flags.limit) : entries;
    console.error(`Bulk-exporting ${limited.length} movie EDLs -> ${outDir}  (delay ${delay}ms, resumable)`);

    let exported = 0, skipped = 0, noTagset = 0, errored = 0;
    for (const [contentId, v] of limited) {
      const ratingKey = contentId.replace(/^plex:/, '');
      const outFile = path.join(outDir, `${ratingKey}.edl.yml`);
      if (!force && existsSync(outFile)) { skipped++; continue; }
      try {
        const movie = await va.movieBySlug(v.vidangel.slug);
        const tagSetId = movie && va.pickTagSetId(movie);
        if (!tagSetId) {
          noTagset++;
          process.stderr.write(`  ∅ ${v.title} — no tag_set on offerings\n`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        const tagSet = await va.tagSet(tagSetId);
        const edl = tagSetToEdl(tagSet, { slug: v.vidangel.slug, title: movie.title, year: movie.year });
        edl.contentId = contentId;
        writeFileSync(outFile, yaml.dump(edl, { lineWidth: 140 }));
        exported++;
        if (exported % 20 === 0) process.stderr.write(`  …${exported} exported (${skipped} skipped)\n`);
      } catch (e) {
        errored++;
        process.stderr.write(`  ✗ ${v.title}: ${e.message}\n`);
      }
      await new Promise((r) => setTimeout(r, delay));
    }
    console.error(`\n✓ Done. exported=${exported} skipped(existing)=${skipped} no-tagset=${noTagset} errors=${errored}`);
    console.error(`EDLs in ${outDir}`);
    return;
  }

  if (command === 'import-mcf') {
    const file = cmdArgs[0];
    if (!file) { console.error('Usage: contentfilter import-mcf <file.mcf> [--content-id plex:ID] [--out file.yml]'); process.exit(1); }
    if (!existsSync(file)) { console.error(`File not found: ${file}`); process.exit(1); }
    const contentId = args.includes('--content-id') ? flags['content-id'] || cmdArgs[1] : null;
    const parsed = parseMcf(readFileSync(file, 'utf8'));
    const edl = mcfToEdl(parsed, { contentId });
    const output = flags.json ? JSON.stringify(edl, null, 2) : yaml.dump(edl, { lineWidth: 140 });
    if (flags.out) { writeFileSync(flags.out, output); console.error(`Imported ${edl.cues.length} cues (${edl.precision}) -> ${flags.out}`); }
    else console.log(output);
    return;
  }

  if (command === 'export-mcf') {
    const ref = cmdArgs[0];
    if (!ref) { console.error('Usage: contentfilter export-mcf <ratingKey|path/to.edl.yml> [--out file.mcf]'); process.exit(1); }
    const edlPath = existsSync(ref) ? ref : path.join(filterCacheDir(), 'edl', `${ref}.edl.yml`);
    if (!existsSync(edlPath)) { console.error(`EDL not found: ${edlPath}`); process.exit(1); }
    const edl = yaml.load(readFileSync(edlPath, 'utf8'));
    const mcf = edlToMcf(edl);
    if (flags.out) { writeFileSync(flags.out, mcf); console.error(`Wrote ${edl.cues.length} cues -> ${flags.out}`); }
    else console.log(mcf);
    return;
  }

  if (command === 'calibrate') {
    const rk = String(cmdArgs[0] || '').replace(/[^0-9]/g, '');
    if (!rk) { console.error('Usage: contentfilter calibrate <plexRatingKey> [--method srt|whisper] [--samples 25] [--window 6] [--model small.en] [--write]'); process.exit(1); }
    const edlPath = path.join(filterCacheDir(), 'edl', `${rk}.edl.yml`);
    if (!existsSync(edlPath)) { console.error(`No EDL for ${rk}: ${edlPath} (run bulk-export/export first)`); process.exit(1); }
    const edl = yaml.load(readFileSync(edlPath, 'utf8'));
    const window = Number(flags.window) || 6;
    const nSamples = Number(flags.samples) || 25;
    const method = flags.method === 'whisper' ? 'whisper' : 'srt';

    // Candidate mute cues we can word-match.
    const mutes = (edl.cues || []).filter((c) => (c.type === 'mute' || c.effect === 'mute') && stemsFor(c.category));
    if (mutes.length < 4) { console.error(`Only ${mutes.length} matchable mute cues — cannot calibrate reliably.`); process.exit(1); }
    const step = Math.max(1, Math.floor(mutes.length / nSamples));
    const picked = mutes.filter((_, i) => i % step === 0).slice(0, nSamples);
    console.error(`Calibrating ${rk} "${edl.title || ''}" via ${method}: ${picked.length}/${mutes.length} mute cues, ±${window}s window`);

    // Plex: part URL + English SRT stream + duration.
    const { token, host } = loadPlexConfig();
    const meta = (await axios.get(`${host}/library/metadata/${rk}?X-Plex-Token=${token}`, { headers: { Accept: 'application/json' } })).data?.MediaContainer?.Metadata?.[0];
    const part = meta?.Media?.[0]?.Part?.[0];
    if (!part) { console.error('Could not resolve Plex media part.'); process.exit(1); }
    const partUrl = `${host}${part.key}?X-Plex-Token=${token}`;

    const pairs = [];
    if (method === 'srt') {
      const srtStream = (part.Stream || []).find((s) => s.streamType === 3 && s.codec === 'srt' && /^en/i.test(s.languageCode || s.language || ''));
      if (!srtStream) { console.error('No English SRT on this Plex item — retry with --method whisper.'); process.exit(1); }
      const srtRaw = (await axios.get(`${host}/library/streams/${srtStream.id}?X-Plex-Token=${token}`, { responseType: 'text' })).data;
      const srt = parseSrt(srtRaw);
      console.error(`  loaded SRT: ${srt.length} lines`);
      for (const c of picked) {
        const snapped = snapCueToSrt(c, srt, window);
        if (snapped != null) pairs.push({ x: c.in, y: snapped, leaf: leafOf(c.category) });
      }
    } else {
      const res = snapCuesWhisper(partUrl, picked.map((c) => ({ id: c.id, sec: c.in, stems: stemsFor(c.category) })), { window, model: flags.model });
      for (const r of res) if (r.snapped != null) pairs.push({ x: r.edl, y: r.snapped });
    }

    console.error(`  snapped ${pairs.length}/${picked.length} cues`);
    if (pairs.length < 4) { console.error('Too few snapped cues to fit a reliable sync.'); process.exit(1); }
    const fit = robustFit(pairs);

    const scaleWarn = Math.abs(fit.scale - 1) > 0.005;
    console.error(`\n================ SYNC ================`);
    console.error(`offset (robust, scale=1):  ${fit.offsetOnly >= 0 ? '+' : ''}${fit.offsetOnly.toFixed(2)}s`);
    console.error(`2-param fit:  scale=${fit.scale.toFixed(5)}  offset=${fit.offsetLS.toFixed(2)}s  R²=${fit.r2.toFixed(4)}`);
    console.error(`points used: ${fit.used}/${fit.total}   median |residual|: ${fit.medAbsResid.toFixed(2)}s`);
    if (scaleWarn) console.error(`⚠ scale deviates from 1 (${fit.scale.toFixed(4)}) — possible framerate mismatch; consider --write with scale.`);

    if (args.includes('--write')) {
      const overridePath = path.join(filterCacheDir(), 'overrides', `${rk}.yml`);
      mkdirSync(path.dirname(overridePath), { recursive: true });
      const existing = existsSync(overridePath) ? (yaml.load(readFileSync(overridePath, 'utf8')) || {}) : {};
      const useScale = scaleWarn;
      existing.contentId = `plex:${rk}`;
      existing.sync = {
        offsetSec: Number((useScale ? fit.offsetLS : fit.offsetOnly).toFixed(3)),
        scale: useScale ? Number(fit.scale.toFixed(6)) : 1,
        method,
        samples: fit.used,
        r2: Number(fit.r2.toFixed(4)),
        medAbsResidSec: Number(fit.medAbsResid.toFixed(3)),
      };
      writeFileSync(overridePath, yaml.dump(existing, { lineWidth: 140 }));
      console.error(`\n✓ wrote sync -> ${overridePath}`);
    } else {
      console.error('\n(dry run — pass --write to save sync to the override)');
    }
    return;
  }

  if (command === 'snap') {
    const rk = String(cmdArgs[0] || '').replace(/[^0-9]/g, '');
    if (!rk) { console.error('Usage: contentfilter snap <plexRatingKey> [--window 6] [--model small.en] [--limit N] [--write]'); process.exit(1); }
    const edlPath = path.join(filterCacheDir(), 'edl', `${rk}.edl.yml`);
    if (!existsSync(edlPath)) { console.error(`No EDL for ${rk}`); process.exit(1); }
    const edl = yaml.load(readFileSync(edlPath, 'utf8'));
    const overridePath = path.join(filterCacheDir(), 'overrides', `${rk}.yml`);
    const override = existsSync(overridePath) ? (yaml.load(readFileSync(overridePath, 'utf8')) || {}) : {};
    const off = override?.sync?.offsetSec || 0;
    const scale = override?.sync?.scale ?? 1;
    const window = Number(flags.window) || 6;

    // Every matchable mute cue -> its EXPECTED local time (EDL cues via sync;
    // srt addCues are already local). Whisper finds the true word boundary there.
    const targets = [];
    for (const c of edl.cues || []) {
      if ((c.type !== 'mute' && c.effect !== 'mute') || !stemsFor(c.category)) continue;
      targets.push({ kind: 'edl', id: c.id, sec: c.in * scale + off, stems: stemsFor(c.category) });
    }
    for (const c of override.addCues || []) {
      if (c.effect !== 'mute' && c.type !== 'mute') continue;
      const stems = stemsFor(c.category) || (c.label ? [c.label.toLowerCase()] : null);
      if (stems) targets.push({ kind: 'add', id: c.id, sec: c.in, stems });
    }
    const picked = args.includes('--limit') ? targets.slice(0, Number(flags.limit) || 10) : targets;
    console.error(`Snapping ${picked.length}/${targets.length} mute cues via Whisper (model ${flags.model}, ±${window}s)…`);

    const { token, host } = loadPlexConfig();
    const meta = (await axios.get(`${host}/library/metadata/${rk}?X-Plex-Token=${token}`, { headers: { Accept: 'application/json' } })).data?.MediaContainer?.Metadata?.[0];
    const part = meta?.Media?.[0]?.Part?.[0];
    if (!part) { console.error('Could not resolve Plex media part.'); process.exit(1); }
    const partUrl = `${host}${part.key}?X-Plex-Token=${token}`;

    const res = snapCuesWhisper(partUrl, picked.map((t) => ({ id: t.id, sec: t.sec, stems: t.stems })), { window, model: flags.model });
    const byId = new Map(res.map((r) => [r.id, r]));
    const kindById = new Map(picked.map((t) => [t.id, t.kind]));

    const cueOverrides = { ...(override.cueOverrides || {}) };
    const addCues = (override.addCues || []).map((c) => ({ ...c }));
    let snapped = 0;
    for (const t of picked) {
      const r = byId.get(t.id);
      if (!r || r.snapped == null) continue;
      const inS = Number(r.snapped.toFixed(3));
      const outS = Number((r.end ?? (r.snapped + 0.3)).toFixed(3));
      snapped++;
      if (kindById.get(t.id) === 'edl') {
        cueOverrides[t.id] = { ...(cueOverrides[t.id] || {}), in: inS, out: outS, precision: 'ms' };
      } else {
        const ac = addCues.find((c) => c.id === t.id);
        if (ac) { ac.in = inS; ac.out = outS; ac.precision = 'ms'; }
      }
    }

    console.error(`\n✓ snapped ${snapped}/${picked.length} to ms word boundaries (${picked.length - snapped} not found — stay approx/wide)`);
    for (const t of picked.slice(0, 10)) {
      const r = byId.get(t.id);
      console.error(`  ${t.id.padEnd(12)} expected ${t.sec.toFixed(1)}s -> ${r?.snapped != null ? `${r.snapped}s..${r.end}s` : 'MISS'}`);
    }

    if (args.includes('--write')) {
      override.contentId = `plex:${rk}`;
      override.cueOverrides = cueOverrides;
      if (addCues.length) override.addCues = addCues;
      mkdirSync(path.dirname(overridePath), { recursive: true });
      writeFileSync(overridePath, yaml.dump(override, { lineWidth: 140 }));
      console.error(`\n✓ wrote ms cueOverrides -> ${overridePath}`);
    } else {
      console.error('\n(dry run — pass --write to save ms boundaries to the override)');
    }
    return;
  }

  if (command === 'srt-mutes') {
    const rk = String(cmdArgs[0] || '').replace(/[^0-9]/g, '');
    if (!rk) { console.error('Usage: contentfilter srt-mutes <plexRatingKey> [--window 1.5] [--write]'); process.exit(1); }
    const edlPath = path.join(filterCacheDir(), 'edl', `${rk}.edl.yml`);
    if (!existsSync(edlPath)) { console.error(`No EDL for ${rk}`); process.exit(1); }
    const edl = yaml.load(readFileSync(edlPath, 'utf8'));
    const overridePath = path.join(filterCacheDir(), 'overrides', `${rk}.yml`);
    const override = existsSync(overridePath) ? (yaml.load(readFileSync(overridePath, 'utf8')) || {}) : {};
    const off = override?.sync?.offsetSec || 0; // existing mutes are source-time; add off to compare in local time
    // Coverage radius: how close an existing mute must be to count as covering this
    // word. Default 1.5s — do NOT inherit the shared --window default (6s, meant for
    // snap/calibrate), which would treat a DIFFERENT nearby swear's mute as covering
    // this one and skip a real gap (e.g. George's "damn" 4.5s from another "damn").
    const coverWin = args.includes('--cover-window') ? (Number(flags['cover-window']) || 1.5) : 1.5;

    // EXACT whole-word forms — startsWith would false-match hello/christmas/assume
    // (the Scunthorpe problem). Emitting mutes demands precision.
    const BAD_WORDS = {
      fuck: ['fuck', 'fucks', 'fuckin', 'fucking', 'fucked', 'fucker', 'motherfucker', 'motherfucking'],
      shit: ['shit', 'shits', 'shitty', 'shithead', 'bullshit', 'shithole'],
      ass: ['ass', 'asses', 'asshole', 'assholes', 'jackass', 'dumbass', 'badass', 'smartass'],
      damn: ['damn', 'damned', 'damnit', 'dammit', 'goddamn', 'goddammit', 'goddamnit'],
      hell: ['hell', 'hells'],
      bitch: ['bitch', 'bitches', 'bitching', 'bitchy'],
      bastard: ['bastard', 'bastards'],
      god: ['god', 'gods'],
      jesus: ['jesus'],
      christ: ['christ'],
    };
    const STEM_GROUP = {};
    for (const s of ['god', 'jesus', 'christ']) STEM_GROUP[s] = 'blasphemy';
    for (const s of ['fuck', 'shit', 'ass', 'damn', 'hell', 'bitch', 'bastard']) STEM_GROUP[s] = 'profanity';
    const FORM_TO_LEAF = {};
    for (const [leaf, forms] of Object.entries(BAD_WORDS)) for (const f of forms) FORM_TO_LEAF[f] = leaf;
    const matchLeaf = (tok) => FORM_TO_LEAF[tok.toLowerCase().replace(/[^a-z]/g, '')] || null;

    // Existing mute cues in LOCAL time (for coverage checks).
    const existingMutes = (edl.cues || [])
      .filter((c) => c.type === 'mute' || c.effect === 'mute')
      .map((c) => c.in + off);
    const covered = (t) => existingMutes.some((m) => Math.abs(m - t) <= coverWin);

    // Fetch the English SRT (LOCAL time).
    const { token, host } = loadPlexConfig();
    const meta = (await axios.get(`${host}/library/metadata/${rk}?X-Plex-Token=${token}`, { headers: { Accept: 'application/json' } })).data?.MediaContainer?.Metadata?.[0];
    const part = meta?.Media?.[0]?.Part?.[0];
    const srtStream = (part?.Stream || []).find((s) => s.streamType === 3 && s.codec === 'srt' && /^en/i.test(s.languageCode || s.language || ''));
    if (!srtStream) { console.error('No English SRT on this Plex item.'); process.exit(1); }
    const srtRaw = (await axios.get(`${host}/library/streams/${srtStream.id}?X-Plex-Token=${token}`, { responseType: 'text' })).data;
    const srt = parseSrt(srtRaw);

    const newCues = [];
    const seen = new Set();
    let found = 0;
    for (const line of srt) {
      const tokens = line.text.split(/\s+/).filter(Boolean);
      tokens.forEach((tok, i) => {
        const leaf = matchLeaf(tok);
        if (!leaf) return;
        found++;
        // A subtitle line's START tracks speech onset, but its END is just when the
        // caption clears — often long after the words. So DON'T spread words across
        // the line span; anchor at line.start and advance at a normal speech rate,
        // capped so we never place a word past the caption's end. The emitted cue is
        // a point that the resolver widens — SRT end is never used as a duration.
        const SECS_PER_WORD = 0.33;
        const wt = Math.min(line.start + i * SECS_PER_WORD, line.end);
        if (covered(wt)) return;
        const key = Math.round(wt * 2); // ~0.5s dedupe
        if (seen.has(key)) return;
        seen.add(key);
        newCues.push({
          id: `srt${Math.round(wt * 1000)}`,
          effect: 'mute',
          category: `language/${STEM_GROUP[leaf]}/${leaf}`,
          in: Number(wt.toFixed(2)),
          out: Number((wt + 0.05).toFixed(2)),
          label: leaf,
          source: 'srt',
          precision: 'srt-line',
        });
      });
    }

    console.error(`SRT profanity found: ${found} | already covered by a mute: ${found - newCues.length} | NEW gap-filling mutes: ${newCues.length}`);
    for (const c of newCues.slice(0, 12)) console.error(`  + ${c.label.padEnd(7)} @ ${c.in}s  (${c.category})`);
    if (newCues.length > 12) console.error(`  … +${newCues.length - 12} more`);

    if (args.includes('--write')) {
      // addCues are LOCAL-time (NOT sync-shifted). Merge, replacing any prior srt-* cues.
      const kept = (override.addCues || []).filter((c) => c.source !== 'srt');
      override.contentId = `plex:${rk}`;
      override.addCues = [...kept, ...newCues];
      mkdirSync(path.dirname(overridePath), { recursive: true });
      writeFileSync(overridePath, yaml.dump(override, { lineWidth: 140 }));
      console.error(`\n✓ wrote ${newCues.length} srt mute addCues -> ${overridePath}`);
    } else {
      console.error('\n(dry run — pass --write to add these mutes to the override)');
    }
    return;
  }

  if (command === 'catalog-sync') {
    // Public, no auth needed — but reuse the client (token is harmless on works).
    const va = new VidAngel({ token: process.env.VIDANGEL_TOKEN || 'public', profile: '' });
    mkdirSync(filterCacheDir(), { recursive: true });
    console.error('Paging VidAngel catalog (public, throttled)…');
    const catalog = await va.catalogSync({ onProgress: (m) => process.stderr.write(`\r${m}        `) });
    process.stderr.write('\n');
    const payload = { fetchedCount: catalog.length, entries: catalog };
    writeFileSync(CATALOG_PATH(), JSON.stringify(payload, null, 0));
    const byType = catalog.reduce((a, c) => ((a[c.type] = (a[c.type] || 0) + 1), a), {});
    const withTags = catalog.filter((c) => c.tagCount > 0).length;
    console.error(`\n✓ Catalog cached: ${catalog.length} titles -> ${CATALOG_PATH()}`);
    console.error(`  by type: ${Object.entries(byType).map(([k, v]) => `${k}=${v}`).join('  ')}`);
    console.error(`  with filter data (tagCount>0): ${withTags}`);
    return;
  }

  if (command === 'map') {
    if (!existsSync(CATALOG_PATH())) {
      console.error('No catalog cache. Run:  node cli/contentfilter.cli.mjs catalog-sync');
      process.exit(1);
    }
    const catalog = JSON.parse(readFileSync(CATALOG_PATH(), 'utf8')).entries || [];
    console.error(`Loaded catalog cache: ${catalog.length} titles. Loading Plex library…`);
    const plex = await plexItems(flags.section, { types: ['movie', 'show'] });
    console.error(`Plex items: ${plex.length}. Matching offline (0 VidAngel calls)…`);
    const result = matchOffline(plex, catalog);
    const { matched, unmatched } = result;
    let ambiguous = result.ambiguous;

    // Optional: disambiguate same-title remakes by fetching each candidate's
    // year (the catalog dump has none). Throttled; only the ambiguous handful.
    if (flags.resolve && ambiguous.length) {
      const va = new VidAngel({ token: process.env.VIDANGEL_TOKEN || 'public', profile: '' });
      console.error(`Resolving ${ambiguous.length} ambiguous titles by year (throttled)…`);
      const stillAmbiguous = [];
      for (const a of ambiguous) {
        const py = a.plex.year;
        const scored = [];
        for (const c of a.candidates) {
          const y = await va.yearForSlug(c.slug, c.type);
          scored.push({ c, y });
          await new Promise((res) => setTimeout(res, 400));
        }
        // Pick the candidate whose year matches the Plex year within 1.
        const exact = py ? scored.filter((s) => s.y != null && Math.abs(s.y - py) <= 1) : [];
        if (exact.length === 1) {
          matched.push({ plex: a.plex, va: { ...exact[0].c, year: exact[0].y }, confidence: 'resolved-by-year' });
          process.stderr.write(`  ✓ ${a.plex.title} (${py}) -> ${exact[0].c.slug}\n`);
        } else {
          a.resolvedYears = scored.map((s) => ({ slug: s.c.slug, year: s.y }));
          stillAmbiguous.push(a);
          process.stderr.write(`  ? ${a.plex.title} (${py}) -> unresolved [${scored.map((s) => `${s.c.slug}:${s.y}`).join(', ')}]\n`);
        }
      }
      ambiguous = stillAmbiguous;
    }

    // Build the map file: plex ratingKey -> VA ref. Only high-confidence rows.
    const map = {};
    for (const m of matched) {
      map[`plex:${m.plex.ratingKey}`] = {
        title: m.plex.title,
        plexType: m.plex.plexType,
        vidangel: { id: m.va.id, slug: m.va.slug, type: m.va.type, tagCount: m.va.tagCount },
        confidence: m.confidence
      };
    }
    mkdirSync(filterCacheDir(), { recursive: true });
    writeFileSync(MAP_PATH(), yaml.dump({
      source: 'vidangel-catalog (offline match)',
      counts: { matched: matched.length, ambiguous: ambiguous.length, unmatched: unmatched.length },
      map
    }, { lineWidth: 140 }));

    if (flags.json) { console.log(JSON.stringify({ matched, ambiguous: ambiguous.slice(0, 50) }, null, 2)); return; }
    console.error(`\n================ MAP ================`);
    console.error(`matched (high-confidence): ${matched.length}`);
    console.error(`ambiguous (same title, needs year): ${ambiguous.length}`);
    console.error(`unmatched: ${unmatched.length}`);
    const filterable = matched.filter((m) => m.va.tagCount > 0).length;
    console.error(`of matched, have filter data now: ${filterable} (rest are shows -> per-episode)`);
    console.error(`\nwrote ${MAP_PATH()}`);
    console.error('\nSample matches:');
    for (const m of matched.filter((x) => x.va.tagCount > 0).slice(0, 15)) {
      console.error(`  [plex:${m.plex.ratingKey}] ${m.plex.title} -> ${m.va.slug} (tags=${m.va.tagCount})`);
    }
    if (ambiguous.length) {
      console.error('\nSample ambiguous (resolve by year later):');
      for (const a of ambiguous.slice(0, 8)) {
        console.error(`  ${a.plex.title} (${a.plex.year}) -> ${a.candidates.map((c) => c.slug).join(', ')}`);
      }
    }
    return;
  }

  if (command === 'match') {
    const va = new VidAngel(loadVidAngelAuth());
    console.error('Loading Plex movies…');
    const movies = await plexItems(flags.section, { types: ['movie'] });
    console.error(`Plex movies: ${movies.length}. Querying VidAngel (this is rate-limited; capped at --limit=${flags.limit})…`);
    const sample = movies.slice(0, flags.limit);
    const hits = [];
    let done = 0;
    for (const m of sample) {
      try {
        const match = await va.findMovie(m.title, m.year);
        if (match) hits.push({ plex: m, va: match });
      } catch (e) {
        // keep going; one failed lookup shouldn't abort the sweep
      }
      if (++done % 25 === 0) console.error(`  …${done}/${sample.length}`);
    }
    if (flags.json) { console.log(JSON.stringify(hits, null, 2)); return; }
    console.log(`\nMatched ${hits.length}/${sample.length} Plex movies to VidAngel filter data:\n${'='.repeat(70)}`);
    for (const h of hits) {
      const warn = h.va.yearMismatch ? `  ⚠ year ${h.va.year} (remake?)` : '';
      console.log(`  ✓ [${h.plex.ratingKey}] ${h.plex.title} (${h.plex.year}) -> ${h.va.title} tags=${h.va.tagCount} slug=${h.va.slug}${warn}`);
    }
    console.log(`\n${hits.length} matches. Export one with: node cli/contentfilter.cli.mjs export <slug> --out <file>`);
    return;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

function printHelp() {
  console.log(`
Content Filter CLI — filter-data lookup + EDL export

Usage:
  node contentfilter.cli.mjs <command> [options]

Commands:
  catalog-sync          Page the FULL filterable catalog -> local cache (public, throttled; do once)
  map [--section <id>]  Offline-match cached catalog vs your Plex library -> plex->VA map file (0 API calls)
  search <query>        Find filterable titles (slug, year, type, tag_count)
  works                 Popular filterable titles available on your services
  tags <slug>           Summarize a title's filter categories + tag counts
  export <slug>         Emit a normalized FilterEDL (YAML; --json for JSON)
  calibrate <ratingKey> Derive a per-file time sync (offset/scale) that aligns cues to your
                        Plex file, via SRT-snap (default) or --method whisper. --write saves it.
  srt-mutes <ratingKey> Scan the Plex English SRT for profanity not covered by an existing
                        mute and emit gap-filling mute cues into the override. --write saves.
  snap <ratingKey>      Whisper-align every mute cue to its true audio word boundary (ms) and
                        write precise in/out into the override. --limit N, --model, --write.
  bulk-export           Export every mapped movie's EDL (token; resumable; --force --delay)
  import-mcf <file>     Parse a .mcf/WebVTT file -> FilterEDL (--content-id plex:ID, --out)
  export-mcf <key|edl>  Serialize an EDL back to .mcf/WebVTT (--out)
  match [--section <id>] Live per-title cross-reference (uses search; prefer catalog-sync+map)

Options:
  --json                Raw JSON output
  --limit <n>           Cap results (default 100)
  --out <path>          (export) write to file instead of stdout
  --section <id>        (match) limit to one Plex movie section

Examples:
  node cli/contentfilter.cli.mjs search "Top Gun"
  node cli/contentfilter.cli.mjs tags top-gun-maverick-5ad0f
  node cli/contentfilter.cli.mjs export plane-e8a36 --out /tmp/plane.edl.yml
  node cli/contentfilter.cli.mjs match --section 6 --limit 50

Precision note: VidAngel tags are integer-SECOND approximations keyed to
VidAngel's source recording — a good FIRST PASS / locator, but mute/bleep needs
a local refinement (subtitle snap or Whisper forced-alignment) and skips need a
small time remap to your file. See the content-filter design doc.
`);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
