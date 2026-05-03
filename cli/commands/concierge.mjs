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

const ACTIONS = {
  satellites: actionSatellites,
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
