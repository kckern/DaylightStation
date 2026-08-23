#!/usr/bin/env node

/**
 * piano-play CLI — put sheet music on the piano kiosk and (optionally) perform it.
 *
 * This is the operator-facing front door for the `piano.launch` bus arm: it
 * finds a score by name so nobody has to remember a content id, then dispatches
 * through DoNow (`POST /api/v1/donow/dispatch`, surface `piano-kiosk`), which
 * broadcasts `kiosk.launch` → the tablet's `useKioskLaunchCommand` → SheetMusic's
 * view route → ScorePlayer's one-shot auto-start.
 *
 * It goes through DoNow rather than poking the bus directly ON PURPOSE: DoNow
 * owns the household occupancy rule (someone mid-practice does not get their
 * screen yanked — you get `pending_approval` instead). `--force` only ever makes
 * that STRICTER (deny instead of ask); there is no bypass here by design.
 *
 * Usage:
 *   node cli/piano-play.cli.mjs list [query]
 *   node cli/piano-play.cli.mjs play <query|contentId> [--mode listen] [--dry-run]
 *
 * Options:
 *   --mode <m>        listen | learn | polish | perform   (default: listen)
 *   --learner <id>    who it is for; a learner already at the piano is not interrupted
 *   --force           never_ask: deny rather than queue an approval when busy
 *   --dry-run         resolve + validate, print the payload, dispatch nothing
 *   --json            machine-readable output
 *   --base-url <url>  app base URL (default: $DAYLIGHT_BASE_URL or http://localhost:3111)
 *
 * Examples:
 *   node cli/piano-play.cli.mjs play "green hill"
 *   node cli/piano-play.cli.mjs play "green hill" --mode perform
 *   node cli/piano-play.cli.mjs list sonic
 *
 * @module cli/piano-play
 */

const BASE = (() => {
  const i = process.argv.indexOf('--base-url');
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1].replace(/\/$/, '');
  return (process.env.DAYLIGHT_BASE_URL || 'http://localhost:3111').replace(/\/$/, '');
})();

const MODES = ['listen', 'learn', 'polish', 'perform'];
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i > 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const positional = args.filter((a, i) => !a.startsWith('--')
  && !(i > 0 && args[i - 1].startsWith('--') && !['--force', '--dry-run', '--json'].includes(args[i - 1])));

const JSON_OUT = flag('json');
function out(obj, human) {
  if (JSON_OUT) console.log(JSON.stringify(obj, null, 2));
  else console.log(human);
}

async function api(path, init) {
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`${res.status} ${path}: ${body?.message || body?.code || text.slice(0, 160)}`);
    err.body = body;
    throw err;
  }
  return body;
}

/**
 * Find candidate scores by fuzzy name. The kiosk's own sheet-music collections
 * are the source of truth for what is playable, so this walks the same list
 * endpoints the ScoreGrid uses rather than inventing a second catalog.
 */
async function findScores(query) {
  // Same config the kiosk reads (`api/v1/admin/apps/piano/config` → .parsed),
  // and the same ref→list mapping as SheetMusic.jsx's collectionListPath: a
  // `source:localId` ref becomes /api/v1/list/<source>/<localId>.
  const cfg = await api('/api/v1/admin/apps/piano/config').catch(() => null);
  const sm = cfg?.parsed?.sheetmusic || null;
  const refs = (sm?.collections || []).map((c) => c.ref).filter(Boolean);
  if (!refs.length && sm?.collection) refs.push(sm.collection);

  const seen = new Map();
  for (const ref of refs) {
    if (typeof ref !== 'string') continue;
    const i = ref.indexOf(':');
    const source = i > 0 ? ref.slice(0, i) : 'plex';
    const localId = i > 0 ? ref.slice(i + 1) : ref;
    const list = await api(`/api/v1/list/${source}/${localId}`).catch(() => null);
    const items = list?.items || list?.list || (Array.isArray(list) ? list : []);
    for (const it of items) {
      const id = it.id || it.contentId;
      if (!id || seen.has(id)) continue;
      seen.set(id, { id, title: it.title || it.label || it.name || id });
    }
  }
  const all = [...seen.values()];
  if (!query) return all;
  // Token match, not substring: filenames are hyphenated
  // ("green-hill-zone-sonic-the-hedgehog"), so a human typing "green hill"
  // must still land. Every token must appear somewhere in title+id.
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const tokens = norm(query).split(' ').filter(Boolean);
  if (!tokens.length) return all;
  return all.filter((s) => {
    const hay = `${norm(s.title)} ${norm(s.id)}`;
    return tokens.every((t) => hay.includes(t));
  });
}

/** A content id already carries `source:localId`; anything else is a search term. */
const looksLikeContentId = (s) => typeof s === 'string' && /^[a-z0-9_-]+:.+/i.test(s);

async function cmdList() {
  const matches = await findScores(positional[1]);
  if (!matches.length) { out({ matches: [] }, 'No scores found.'); process.exitCode = 1; return; }
  out({ matches }, matches.map((m) => `${m.title}\n  ${m.id}`).join('\n'));
}

async function cmdPlay() {
  const term = positional[1];
  if (!term) { console.error('usage: piano-play play <query|contentId> [--mode listen]'); process.exitCode = 2; return; }

  const mode = opt('mode', 'listen');
  if (!MODES.includes(mode)) {
    console.error(`--mode must be one of: ${MODES.join(', ')}`);
    process.exitCode = 2; return;
  }

  let contentId = term;
  if (!looksLikeContentId(term)) {
    const matches = await findScores(term);
    if (!matches.length) {
      out({ ok: false, error: 'no_match', query: term }, `No score matches "${term}". Try: piano-play list`);
      process.exitCode = 1; return;
    }
    if (matches.length > 1) {
      // Ambiguity is the caller's to resolve — never silently pick one.
      out({ ok: false, error: 'ambiguous', matches },
        `"${term}" matches ${matches.length} scores — be more specific:\n`
        + matches.map((m) => `  ${m.title}\n    ${m.id}`).join('\n'));
      process.exitCode = 1; return;
    }
    contentId = matches[0].id;
    if (!JSON_OUT) console.log(`→ ${matches[0].title}`);
  }

  const action = { contentId, play: mode };
  const payload = {
    surface: 'piano-kiosk',
    action,
    learnerId: opt('learner', null),
    ...(flag('force') ? { force: 'never_ask' } : {}),
  };

  if (flag('dry-run')) { out({ dryRun: true, payload }, `DRY RUN — would dispatch:\n${JSON.stringify(payload, null, 2)}`); return; }

  const result = await api('/api/v1/donow/dispatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const line = result.decision === 'dispatch' || result.dispatched
    ? `▶ playing ${contentId} (${mode}) on the piano kiosk`
    : result.decision === 'pending_approval'
      ? `⏸ ${result.message || 'the piano is busy — approval requested'} (approvalId ${result.approvalId})`
      : `✗ ${result.decision || 'refused'}: ${result.message || JSON.stringify(result)}`;
  out(result, line);
  if (result.decision && result.decision !== 'dispatch') process.exitCode = 1;
}

const COMMANDS = { list: cmdList, play: cmdPlay };

(async () => {
  const cmd = positional[0];
  const fn = COMMANDS[cmd];
  if (!fn) {
    console.error('usage: piano-play <list|play> [args]   (--help in the module docblock)');
    process.exitCode = 2; return;
  }
  try {
    await fn();
  } catch (err) {
    if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: err.message, body: err.body || null }, null, 2));
    else console.error(`✗ ${err.message}`);
    process.exitCode = 1;
  }
})();
