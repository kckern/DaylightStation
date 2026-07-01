#!/usr/bin/env node
/**
 * player-review — drive the Player to a surgical point in time and capture what it
 * shows, so the content-filter test/evaluate loop is one command instead of an
 * ad-hoc Playwright script.
 *
 * It launches the screen route with the ?goto surgical seek (see
 * frontend/src/lib/Player/reviewParams.js), waits for playback to land on target,
 * screenshots, and prints the live state (playhead, firing effect, debug-HUD text).
 * Cue-by-id resolves to a concrete ?goto time using the SAME effective-cue math the
 * player uses (resolveEffectiveCues → gotoForCueId), so the sync offset + lead match.
 *
 * Usage:
 *   node cli/player-review.cli.mjs cues  <contentId>
 *   node cli/player-review.cli.mjs goto  <contentId> <seconds> [flags]
 *   node cli/player-review.cli.mjs cue   <contentId> <cueId> [lead] [flags]
 *
 *   contentId : plex:662170  (or bare 662170)
 *   flags:
 *     --exact          (cue) land exactly <lead>s before the cue, skipping the
 *                      walk-back to a clean gap — best for a cue in a dense cluster
 *     --host <url>     app base URL         (default http://localhost:3111)
 *     --screen <id>    screen route         (default living-room)
 *     --out <path>     screenshot path      (default _deleteme/player-review/<id>-<t>.png)
 *     --headed         show the browser
 *     --no-filter      goto without the content filter (goto only; cue always filters)
 *     --settle <sec>   extra dwell after landing before the shot (default 2.5)
 *     --timeout <sec>  max wait for landing  (default 60)
 *     --width/--height viewport             (default 1280x720)
 *
 * Examples:
 *   node cli/player-review.cli.mjs cues plex:662170
 *   node cli/player-review.cli.mjs goto plex:662170 1800
 *   node cli/player-review.cli.mjs cue  plex:662170 va3388882      # ~1.5s before it fires
 *   node cli/player-review.cli.mjs cue  plex:662170 va3388882 3    # 3s lead, headed
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveEffectiveCues } from '../frontend/src/lib/Player/contentFilter.js';
import { gotoForCueId, DEFAULT_LEAD_SEC } from '../frontend/src/lib/Player/filterDebug.js';

const ROOT = pathResolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---- args ---------------------------------------------------------------------
const argv = process.argv.slice(2);
const command = argv[0];
const positional = argv.slice(1).filter((a) => !a.startsWith('--'));
const flags = {};
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue;
  const key = argv[i].slice(2);
  const next = argv[i + 1];
  if (next && !next.startsWith('--')) { flags[key] = next; i++; } else { flags[key] = true; }
}

const HOST = (flags.host || 'http://localhost:3111').replace(/\/$/, '');
const SCREEN = flags.screen || 'living-room';
const SETTLE_MS = Math.round((parseFloat(flags.settle) || 2.5) * 1000);
const TIMEOUT_MS = Math.round((parseFloat(flags.timeout) || 60) * 1000);
const VW = parseInt(flags.width, 10) || 1280;
const VH = parseInt(flags.height, 10) || 720;

const ratingKey = (id) => String(id || '').replace(/^plex:/, '');
const toContentId = (id) => (/^\w+:/.test(id) ? id : `plex:${id}`);

function die(msg) { console.error(`✗ ${msg}`); process.exit(1); }

// ---- filter data --------------------------------------------------------------
async function fetchFilterData(contentId) {
  const url = `${HOST}/api/v1/content-filter/${ratingKey(contentId)}`;
  const r = await fetch(url);
  if (!r.ok) die(`content-filter fetch failed (${r.status}) for ${contentId}`);
  return r.json();
}

async function effectiveCuesFor(contentId) {
  const { edl, profile, override } = await fetchFilterData(contentId);
  if (!edl) die(`no EDL for ${contentId} (is filtering configured for this title?)`);
  return { cues: resolveEffectiveCues({ edl, profile, override }), edl };
}

const fmt = (s) => (Number.isFinite(s) ? s.toFixed(2) : '—');

// ---- commands -----------------------------------------------------------------
async function cmdCues(contentId) {
  const { cues, edl } = await effectiveCuesFor(contentId);
  console.log(`\n${edl.title || contentId} — ${cues.length} effective cues (times are sync-adjusted)\n`);
  const icon = { skip: '⏭️', 'skip-card': '🎬', mute: '🔇', bleep: '📢', blur: '🌫️', 'full-blur': '🌑', 'censor-bar': '⬛', pixelate: '🔲', 'title-card': '🪧' };
  cues.forEach((c, i) => {
    console.log(
      `${String(i + 1).padStart(3)}  ${(icon[c.effect] || '🎛️')} ${String(c.effect).padEnd(10)} `
      + `${String(c.id).padEnd(12)} ${fmt(c.in)}–${fmt(c.out)}  ${c.category || ''}`
    );
  });
  console.log(`\n→ review one:  node cli/player-review.cli.mjs cue ${contentId} <id>\n`);
}

async function drive({ contentId, goto, filter, label, waitUntilTime = null }) {
  const params = new URLSearchParams({ play: toContentId(contentId), goto: String(Math.floor(goto)) });
  if (filter) { params.set('filter', '1'); params.set('filter-debug', '1'); }
  const url = `${HOST}/screen/${SCREEN}?${params}`;
  const out = flags.out
    ? pathResolve(process.cwd(), flags.out)
    : pathResolve(ROOT, `_deleteme/player-review/${ratingKey(contentId)}-${label}.png`);
  mkdirSync(dirname(out), { recursive: true });

  console.log(`▶ ${url}`);
  const browser = await chromium.launch({ headless: !flags.headed, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('  pageerror:', e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  const read = () => page.evaluate(() => {
    const host = document.querySelector('.video-element, dash-video, video');
    const v = host?.shadowRoot?.querySelector('video') || host;
    const hud = document.querySelector('.filter-debug-hud');
    return {
      t: v && Number.isFinite(v.currentTime) ? v.currentTime : null,
      paused: v ? v.paused : null,
      readyState: v ? v.readyState : 0,
      effect: document.querySelector('.filter-overlay [data-filter-effect]')?.getAttribute('data-filter-effect') || null,
      hud: hud ? hud.innerText.replace(/\s+/g, ' ').trim() : null,
    };
  });

  // Plex mints a fresh transcode AT the target offset; that warmup can take tens of
  // seconds during which currentTime is already the target but readyState is 1 and the
  // clock is frozen. Wait for ACTUAL playback: near target, readyState≥3, and the clock
  // advancing between polls — not merely currentTime being set.
  const deadline = Date.now() + TIMEOUT_MS;
  let state = await read();
  let prevT = state.t;
  let playing = false;
  process.stdout.write('  warming transcode');
  while (Date.now() < deadline) {
    await page.waitForTimeout(1000);
    state = await read();
    process.stdout.write('.');
    const nearTarget = state.t != null && state.t >= goto - 2;
    const advancing = state.t != null && prevT != null && state.t > prevT + 0.05;
    prevT = state.t;
    if (nearTarget && state.readyState >= 3 && advancing) { playing = true; break; }
  }
  process.stdout.write('\n');
  if (!playing) {
    console.error(`  ⚠ playback didn't start within ${TIMEOUT_MS / 1000}s (playhead ${state?.t ?? 'n/a'}, readyState ${state?.readyState ?? 'n/a'})`);
  }
  if (waitUntilTime != null && playing) {
    // Cue review lands ~lead seconds BEFORE the target cue (and, when overlapping
    // cues force the lead-in earlier, well before it) — dwell until the playhead
    // reaches the TARGET cue's in-point so the shot captures THAT cue firing, not an
    // intervening one. Bounded by the gap to cross plus warmup slack.
    const gapMs = Math.max(0, (waitUntilTime - (state.t ?? goto))) * 1000;
    const dwellDeadline = Date.now() + gapMs + 20000;
    while (Date.now() < dwellDeadline) {
      await page.waitForTimeout(400);
      state = await read();
      if (state.t != null && state.t >= waitUntilTime - 0.2) break;
    }
    await page.waitForTimeout(600); // let the overlay paint
    state = await read();
  } else {
    await page.waitForTimeout(SETTLE_MS);
    state = await read();
  }
  await page.screenshot({ path: out });
  await browser.close();

  console.log(`✓ ${JSON.stringify({ target: Math.round(goto * 100) / 100, landed: state.t == null ? null : Math.round(state.t * 10) / 10, firing: state.effect, paused: state.paused })}`);
  if (state.hud) console.log(`  HUD: ${state.hud}`);
  console.log(`  📸 ${out}`);
}

async function cmdGoto(contentId, seconds) {
  const goto = parseFloat(seconds);
  if (!Number.isFinite(goto) || goto < 0) die(`bad <seconds>: ${seconds}`);
  await drive({ contentId, goto, filter: !flags['no-filter'], label: `t${Math.floor(goto)}` });
}

async function cmdCue(contentId, cueId, lead) {
  const { cues } = await effectiveCuesFor(contentId);
  const cue = cues.find((c) => c.id === cueId);
  if (!cue) {
    const near = cues.slice(0, 6).map((c) => c.id).join(', ');
    die(`cue "${cueId}" not found among ${cues.length} cues. First few: ${near}\n  list them:  node cli/player-review.cli.mjs cues ${contentId}`);
  }
  const leadSec = lead != null ? parseFloat(lead) : DEFAULT_LEAD_SEC;
  // Default: nonFiringLeadIn — land at the nearest CLEAN gap before the cue (walks back
  // past overlapping cues, so a cue in a dense cluster can start far earlier).
  // --exact: land exactly leadSec before the cue's in-point regardless of overlaps —
  // best for a cue buried in a cluster where landing inside an expected effect is fine.
  const targetTime = flags.exact
    ? Math.max(0, cue.in - leadSec)
    : gotoForCueId(cues, cueId, leadSec).targetTime;
  const mode = flags.exact ? 'exact' : 'clean';
  console.log(`◎ cue ${cueId} (${cue.effect} ${fmt(cue.in)}–${fmt(cue.out)}) → goto ${targetTime.toFixed(2)}s  [${mode} lead ${leadSec}s]`);
  await drive({ contentId, goto: targetTime, filter: true, label: `cue-${cueId}`, waitUntilTime: cue.in });
}

// ---- main ---------------------------------------------------------------------
const USAGE = `player-review — surgical Player review loop (${HOST})

  node cli/player-review.cli.mjs cues  <contentId>
  node cli/player-review.cli.mjs goto  <contentId> <seconds> [--headed --no-filter --out p]
  node cli/player-review.cli.mjs cue   <contentId> <cueId> [lead] [--exact --headed --out p]

  contentId = plex:662170 (or bare 662170).  Screenshots land in _deleteme/player-review/.
  cue default lands at the nearest clean gap before the cue; --exact lands <lead>s before it.
`;

try {
  if (!command || ['help', '-h', '--help'].includes(command)) { console.log(USAGE); process.exit(0); }
  else if (command === 'cues') { if (!positional[0]) die('cues <contentId>'); await cmdCues(positional[0]); }
  else if (command === 'goto') { if (positional.length < 2) die('goto <contentId> <seconds>'); await cmdGoto(positional[0], positional[1]); }
  else if (command === 'cue') { if (positional.length < 2) die('cue <contentId> <cueId> [lead]'); await cmdCue(positional[0], positional[1], positional[2]); }
  else die(`unknown command "${command}"\n${USAGE}`);
} catch (e) {
  die(e?.stack || e?.message || String(e));
}
