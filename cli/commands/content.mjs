/**
 * dscli content — content search and resolution.
 *
 * Actions:
 *   dscli content search "<query>" [--take N]   — Search across configured sources.
 *
 * Returns: { results: [...], count, sources }
 *
 * Foundation Phase B wires only Plex search. Other sources (immich, audiobookshelf,
 * etc.) ride the same path as soon as the bootstrap factory enables them.
 *
 * NOTE: ContentQueryService.search() takes a query object ({ text, source, ... }),
 * not a raw string. The command wraps the user's query text in { text } before
 * passing it to the service.
 */

import { printJson, printError, EXIT_OK, EXIT_FAIL, EXIT_USAGE, EXIT_CONFIG } from '../_output.mjs';

const HELP = `
dscli content — content search

Usage:
  dscli content <action> [args] [flags]

Actions:
  search "<query>" [--take N]
              Search media content across configured sources.
              Returns: { results, count, sources }

Examples:
  dscli content search "workout playlist"
  dscli content search "plex: cartoon" --take 3
`.trimStart();

async function actionSearch(args, deps) {
  // positional[0] is "search"; remainder is the query (joined with spaces
  // so unquoted multi-word queries still work).
  const queryText = args.positional.slice(1).join(' ').trim();
  if (!queryText) {
    deps.stderr.write('dscli content search: missing required query text\n');
    deps.stderr.write(HELP);
    return { exitCode: EXIT_USAGE };
  }

  let queryService;
  try {
    queryService = await deps.getContentQuery();
  } catch (err) {
    printError(deps.stderr, { error: 'config_error', message: err.message });
    return { exitCode: EXIT_CONFIG };
  }

  // ContentQueryService.search() takes a query object, not a plain string.
  let result;
  try {
    result = await queryService.search({ text: queryText });
  } catch (err) {
    printError(deps.stderr, { error: 'content_error', message: err.message });
    return { exitCode: EXIT_FAIL };
  }
  const items = Array.isArray(result?.items) ? result.items : [];
  const take = parseInt(args.flags.take, 10);
  const results = Number.isFinite(take) && take > 0 ? items.slice(0, take) : items;

  printJson(deps.stdout, {
    results,
    count: results.length,
    sources: result?.sources ?? [],
  });
  return { exitCode: EXIT_OK };
}

const ACTIONS = {
  search: actionSearch,
};

export default {
  name: 'content',
  description: 'Content search across media sources',
  requiresBackend: false,
  async run(args, deps) {
    if (args.help) {
      deps.stdout.write(HELP);
      return { exitCode: EXIT_OK };
    }

    const action = args.positional[0];
    if (!action || !ACTIONS[action]) {
      deps.stderr.write(`dscli content: unknown action: ${action ?? '(none)'}\n`);
      deps.stderr.write(HELP);
      return { exitCode: EXIT_USAGE };
    }

    return ACTIONS[action](args, deps);
  },
};
