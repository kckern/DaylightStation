/**
 * dscli concierge — list satellites and read transcript files.
 *
 * Actions:
 *   dscli concierge satellites                — list configured satellites
 *   dscli concierge transcripts list [--days N] [--satellite X]
 *                                             — list recent transcript ids
 *   dscli concierge transcript <id>            — dump one transcript JSON
 *
 * NOTE: `concierge ask` (streaming agent invocation) is deferred — needs a
 * provisioned DAYLIGHT_BRAIN_TOKEN_<ID> in env or the secrets store. Once that's
 * in place, the ask action can be added via the same backend Bearer-auth path
 * the voice satellites use.
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { printJson, printError, EXIT_OK, EXIT_FAIL, EXIT_USAGE, EXIT_CONFIG } from '../_output.mjs';

const HELP = `
dscli concierge — agent satellite + transcript inspection

Usage:
  dscli concierge <action> [args] [flags]

Actions:
  satellites
              List configured satellites from concierge.yml.
              Returns: { satellites, count }

  transcripts list [--days N] [--satellite X]
              List recent transcript ids under {mediaDir}/logs/concierge.
              --days defaults to 7. --satellite filters to one satellite id.
              Returns: { transcripts, count }

  transcript <id>
              Dump a transcript JSON. <id> is the request id portion of the
              filename (the part before .json). Recursive scan finds the most
              recent matching file.
              Returns: full transcript object
`.trimStart();

async function actionSatellites(args, deps) {
  let cfg;
  try {
    cfg = await deps.getConciergeConfig();
  } catch (err) {
    printError(deps.stderr, { error: 'config_error', message: err.message });
    return { exitCode: EXIT_CONFIG };
  }

  const satellites = (cfg.satellites || []).map((s) => ({
    id: s.id,
    area: s.area ?? null,
    media_player_entity: s.media_player_entity ?? null,
    allowed_skills: s.allowed_skills ?? [],
    scopes_allowed: s.scopes_allowed ?? [],
    scopes_denied: s.scopes_denied ?? [],
  }));
  printJson(deps.stdout, { satellites, count: satellites.length });
  return { exitCode: EXIT_OK };
}

/**
 * Walk the concierge transcript tree and yield {file, satellite, day, id, mtimeMs}
 * for every *.json under {transcriptDir}/{day}/{satellite}/. Tolerates missing
 * subdirs silently — voice satellites only write when they receive requests, so
 * empty days/satellites are normal.
 *
 * @param {string} transcriptDir - {mediaDir}/logs/concierge
 * @param {{ days?: number, satelliteFilter?: string }} opts
 */
async function* walkTranscripts(transcriptDir, { days = 7, satelliteFilter = null } = {}) {
  let dayEntries = [];
  try {
    dayEntries = await fsp.readdir(transcriptDir, { withFileTypes: true });
  } catch {
    return; // tree doesn't exist yet — no transcripts
  }
  // Day dirs are named YYYY-MM-DD; sort descending so newest first.
  const dayDirs = dayEntries
    .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, days);

  for (const day of dayDirs) {
    const dayPath = path.join(transcriptDir, day);
    let satEntries = [];
    try {
      satEntries = await fsp.readdir(dayPath, { withFileTypes: true });
    } catch { continue; }
    for (const sat of satEntries) {
      if (!sat.isDirectory()) continue;
      if (satelliteFilter && sat.name !== satelliteFilter) continue;
      const satPath = path.join(dayPath, sat.name);
      let files = [];
      try {
        files = await fsp.readdir(satPath, { withFileTypes: true });
      } catch { continue; }
      for (const f of files) {
        if (!f.isFile() || !f.name.endsWith('.json')) continue;
        const file = path.join(satPath, f.name);
        // Filename pattern: {ts}-{reqid}.json — strip .json, take everything after the first hyphen.
        const base = f.name.slice(0, -5);
        const dashIdx = base.indexOf('-');
        const id = dashIdx >= 0 ? base.slice(dashIdx + 1) : base;
        let mtimeMs = 0;
        try {
          const st = await fsp.stat(file);
          mtimeMs = st.mtimeMs;
        } catch { /* file may have been removed mid-scan */ }
        yield { file, satellite: sat.name, day, id, mtimeMs };
      }
    }
  }
}

async function actionTranscripts(args, deps) {
  // Sub-action: only `list` for now. Default if omitted.
  const sub = args.positional[1];
  if (sub && sub !== 'list') {
    deps.stderr.write(`dscli concierge transcripts: unknown sub-action: ${sub}\n`);
    deps.stderr.write(HELP);
    return { exitCode: EXIT_USAGE };
  }

  let dir;
  try { dir = await deps.getTranscriptDir(); }
  catch (err) { printError(deps.stderr, { error: 'config_error', message: err.message }); return { exitCode: EXIT_CONFIG }; }

  const days = parseInt(args.flags.days, 10);
  const satelliteFilter = args.flags.satellite || null;
  const opts = {
    days: Number.isFinite(days) && days > 0 ? days : 7,
    satelliteFilter,
  };

  const transcripts = [];
  try {
    for await (const t of walkTranscripts(dir, opts)) {
      transcripts.push({
        id: t.id,
        satellite: t.satellite,
        day: t.day,
        mtime: new Date(t.mtimeMs).toISOString(),
      });
    }
  } catch (err) {
    printError(deps.stderr, { error: 'transcript_error', message: err.message });
    return { exitCode: EXIT_FAIL };
  }

  // Newest first by mtime
  transcripts.sort((a, b) => b.mtime.localeCompare(a.mtime));
  printJson(deps.stdout, { transcripts, count: transcripts.length });
  return { exitCode: EXIT_OK };
}

async function actionTranscript(args, deps) {
  const id = args.positional[1];
  if (!id) {
    deps.stderr.write('dscli concierge transcript: missing required <id>\n');
    deps.stderr.write(HELP);
    return { exitCode: EXIT_USAGE };
  }

  let dir;
  try { dir = await deps.getTranscriptDir(); }
  catch (err) { printError(deps.stderr, { error: 'config_error', message: err.message }); return { exitCode: EXIT_CONFIG }; }

  // Recursive scan; pick the most recent file whose extracted id matches.
  let bestMatch = null;
  try {
    for await (const t of walkTranscripts(dir, { days: 365 })) {
      if (t.id !== id) continue;
      if (!bestMatch || t.mtimeMs > bestMatch.mtimeMs) bestMatch = t;
    }
  } catch (err) {
    printError(deps.stderr, { error: 'transcript_error', message: err.message });
    return { exitCode: EXIT_FAIL };
  }

  if (!bestMatch) {
    printError(deps.stderr, { error: 'not_found', id });
    return { exitCode: EXIT_FAIL };
  }

  let raw;
  try { raw = await fsp.readFile(bestMatch.file, 'utf8'); }
  catch (err) { printError(deps.stderr, { error: 'transcript_error', message: err.message }); return { exitCode: EXIT_FAIL }; }

  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (err) { printError(deps.stderr, { error: 'transcript_error', message: 'malformed JSON: ' + err.message }); return { exitCode: EXIT_FAIL }; }

  printJson(deps.stdout, parsed);
  return { exitCode: EXIT_OK };
}

const ACTIONS = {
  satellites: actionSatellites,
  transcripts: actionTranscripts,
  transcript: actionTranscript,
};

export default {
  name: 'concierge',
  description: 'Agent satellite + transcript inspection',
  requiresBackend: false,
  async run(args, deps) {
    if (args.help) {
      deps.stdout.write(HELP);
      return { exitCode: EXIT_OK };
    }
    const action = args.positional[0];
    if (!action || !ACTIONS[action]) {
      deps.stderr.write(`dscli concierge: unknown action: ${action ?? '(none)'}\n`);
      deps.stderr.write(HELP);
      return { exitCode: EXIT_USAGE };
    }
    return ACTIONS[action](args, deps);
  },
};
