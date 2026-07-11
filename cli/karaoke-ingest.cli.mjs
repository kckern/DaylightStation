#!/usr/bin/env node
// cli/karaoke-ingest.cli.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import * as cfg from './karaoke-ingest/config.mjs';
import { parseSetlist, serializeSetlist } from './karaoke-ingest/setlist.mjs';
import { runIngest } from './karaoke-ingest/ingestRun.mjs';
import { search, download, embed } from './karaoke-ingest/ytdlp.mjs';
import { filterKaraokeSiblings, toCandidateRows, serializeCandidates } from './karaoke-ingest/discovery.mjs';
import { refreshSection } from './karaoke-ingest/plex.mjs';
import { parseSeedTsv, convertSeed } from './karaoke-ingest/convertSeed.mjs';

const exec = promisify(execFile);

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { args[key] = true; }
      else { args[key] = next; i++; }
    } else { args._.push(a); }
  }
  return args;
}

async function fileExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

function ingestConfig() {
  return {
    mediaDir: cfg.MEDIA_DIR, showName: cfg.SHOW_NAME, formatSort: cfg.FORMAT_SORT, mergeFormat: cfg.MERGE_FORMAT,
    searchCount: cfg.SEARCH_COUNT, formatFilter: cfg.FORMAT_FILTER, karaokeTerms: cfg.KARAOKE_TERMS, rejectTerms: cfg.REJECT_TERMS,
    channelWeights: cfg.CHANNEL_WEIGHTS, minDurationS: cfg.MIN_DURATION_S, maxDurationS: cfg.MAX_DURATION_S,
    scoreFloor: cfg.SCORE_FLOOR, seasonName: cfg.seasonName,
  };
}

function ingestDeps() {
  return {
    search: (q, o) => search(q, o),
    download: (a) => download(a),
    // Remux/tag into the final .mp4, then drop the .tmp.mp4 download so Plex
    // never scans a half-named sibling (on failure too, via finally).
    embed: async (a) => {
      try { await embed(a); }
      finally { await fs.rm(a.inPath, { force: true }).catch(() => {}); }
    },
    fileExists,
    saveRows: async (rows) => { await fs.writeFile(cfg.SETLIST_PATH, serializeSetlist(rows)); },
    log: (m) => console.log(m),
  };
}

async function loadRows(setlistPath) {
  const tsv = await fs.readFile(setlistPath, 'utf8');
  return parseSetlist(tsv);
}

async function cmdIngest(args, { dryRun }) {
  const rows = await loadRows(args.setlist || cfg.SETLIST_PATH);
  const options = {
    dryRun,
    force: !!args.force,
    season: args.season ? Number(args.season) : undefined,
    limit: args.limit ? Number(args.limit) : undefined,
  };
  const summary = await runIngest({ rows, config: ingestConfig(), deps: ingestDeps(), options });
  console.log(`\n${dryRun ? 'PLAN' : 'DONE'}: downloaded=${summary.downloaded} skipped=${summary.skipped} failed=${summary.failed}`);
}

async function cmdDiscover(args) {
  const rows = await loadRows(args.setlist || cfg.SETLIST_PATH);
  const existingIds = new Set(rows.map((r) => r.videoId).filter(Boolean));
  const seedIds = rows.filter((r) => r.videoId).map((r) => r.videoId);
  const limit = args.limit ? Number(args.limit) : seedIds.length;
  const collected = [];
  const MB = 64 * 1024 * 1024;
  for (const id of seedIds.slice(0, limit)) {
    // 1) Resolve the seed video's channel (uploads) URL — NOT its own watch URL.
    let channelUrl = null;
    try {
      const { stdout } = await exec('yt-dlp', [
        '--js-runtimes', 'node', '-J', '--no-warnings', '--no-playlist',
        `https://www.youtube.com/watch?v=${id}`,
      ], { maxBuffer: MB });
      const meta = JSON.parse(stdout);
      channelUrl = meta.channel_url || meta.uploader_url
        || (meta.channel_id ? `https://www.youtube.com/channel/${meta.channel_id}` : null);
    } catch { /* unresolved seed — skip */ }
    if (!channelUrl) continue;
    // 2) Flat-list that channel's recent uploads and keep karaoke siblings.
    const uploadsUrl = /\/videos\/?$/.test(channelUrl) ? channelUrl : `${channelUrl}/videos`;
    let info = {};
    try {
      const { stdout } = await exec('yt-dlp', [
        '--js-runtimes', 'node', '-J', '--flat-playlist', '--no-warnings',
        '--playlist-end', '40', uploadsUrl,
      ], { maxBuffer: MB });
      info = JSON.parse(stdout);
    } catch { continue; }
    const entries = Array.isArray(info.entries) ? info.entries : [];
    const kept = filterKaraokeSiblings(entries, existingIds, { karaokeTerms: cfg.KARAOKE_TERMS, rejectTerms: cfg.REJECT_TERMS });
    collected.push(...toCandidateRows(kept, id));
    kept.forEach((k) => existingIds.add(k.id));
  }
  await fs.writeFile(cfg.CANDIDATES_PATH, serializeCandidates(collected));
  console.log(`Wrote ${collected.length} candidates → ${cfg.CANDIDATES_PATH}`);
}

async function cmdConvertSeed(args) {
  const src = args.seed || path.join(cfg.MEDIA_DIR, 'ultimate_theatrical_karaoke_setlist.tsv');
  const seed = parseSeedTsv(await fs.readFile(src, 'utf8'));
  const { rows, unmatched } = convertSeed(seed, cfg.resolveSeason);
  if (args['dry-run']) {
    console.log(serializeSetlist(rows));
    if (unmatched.length) console.error(`\n# ${unmatched.length} unmatched: ${unmatched.map((u) => `${u.song} [${u.category}]`).join(', ')}`);
    return;
  }
  await fs.writeFile(cfg.SETLIST_PATH, serializeSetlist(rows));
  console.log(`Wrote ${rows.length} rows → ${cfg.SETLIST_PATH}`);
  if (unmatched.length) console.error(`${unmatched.length} unmatched (assign a season manually): ${unmatched.map((u) => u.category).join(', ')}`);
}

async function cmdRefreshPlex(args) {
  const host = args.host || process.env.PLEX_HOST || 'http://localhost:32400';
  const token = args.token || process.env.PLEX_TOKEN;
  const sectionId = args.section || process.env.PLEX_SLOWTV_SECTION;
  if (!token || !sectionId) { console.error('Need --token and --section (or PLEX_TOKEN / PLEX_SLOWTV_SECTION).'); process.exit(1); }
  await refreshSection({ host, sectionId, token });
  console.log('Triggered Plex section refresh.');
}

const HELP = `karaoke-ingest — build the Karaoke Plex show from a setlist

Usage:
  karaoke-ingest ingest        [--season N] [--limit N] [--force] [--setlist path]
  karaoke-ingest plan          [--season N] [--limit N]        # dry-run of ingest
  karaoke-ingest discover      [--limit N] [--setlist path]     # harvest channel siblings → candidates.tsv
  karaoke-ingest convert-seed  [--seed path] [--dry-run]        # seed TSV → setlist.tsv
  karaoke-ingest refresh-plex  [--host url] [--section id] [--token tkn]
`;

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const cmd = args._[0];
  switch (cmd) {
    case 'ingest': return cmdIngest(args, { dryRun: false });
    case 'plan': return cmdIngest(args, { dryRun: true });
    case 'discover': return cmdDiscover(args);
    case 'convert-seed': return cmdConvertSeed(args);
    case 'refresh-plex': return cmdRefreshPlex(args);
    default: process.stdout.write(HELP); if (!cmd) process.exit(0); process.exit(1);
  }
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
