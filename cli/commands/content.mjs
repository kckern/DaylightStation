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

import { printJson, printError, EXIT_OK, EXIT_FAIL, EXIT_USAGE, EXIT_CONFIG, EXIT_BACKEND } from '../_output.mjs';

function backendUrl() {
  return process.env.DSCLI_BACKEND_URL || 'http://localhost:3111';
}

const HELP = `
dscli content — content search

Usage:
  dscli content <action> [args] [flags]

Actions:
  search "<query>" [--take N]
              Search media content across configured sources.
              Returns: { results, count, sources }
  resolve <source>:<id>
              Look up one content item by source key.
              Returns: full metadata object
  list-libraries
              List configured content categories.
              Returns: { categories, count }
  play <source>:<id> --to <deviceId> [--shader X] [--shuffle] [--enqueue play|add] --allow-write
              Load content on a device via the running backend.
              GET /api/v1/device/<deviceId>/load?queue=...&shader=...&shuffle=1
              Returns: { ok, device, key, ... }. Audited.

Examples:
  dscli content search "workout playlist"
  dscli content search "plex: cartoon" --take 3
  dscli content resolve plex:642120
  dscli content play plex:642120 --to livingroom-tv --shader dark --allow-write
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

async function actionResolve(args, deps) {
  const key = args.positional[1];
  if (!key || !key.includes(':')) {
    deps.stderr.write('dscli content resolve: missing or malformed <source:id> (e.g. plex:642120)\n');
    deps.stderr.write(HELP);
    return { exitCode: EXIT_USAGE };
  }
  const colonIdx = key.indexOf(':');
  const source = key.slice(0, colonIdx);
  const localId = key.slice(colonIdx + 1);

  let queryService;
  try {
    queryService = await deps.getContentQuery();
  } catch (err) {
    printError(deps.stderr, { error: 'config_error', message: err.message });
    return { exitCode: EXIT_CONFIG };
  }

  let item;
  try {
    item = await queryService.resolve(source, localId);
  } catch (err) {
    printError(deps.stderr, { error: 'content_error', message: err.message });
    return { exitCode: EXIT_FAIL };
  }

  if (!item) {
    printError(deps.stderr, { error: 'not_found', source, localId });
    return { exitCode: EXIT_FAIL };
  }

  printJson(deps.stdout, item);
  return { exitCode: EXIT_OK };
}

async function actionListLibraries(args, deps) {
  let queryService;
  try {
    queryService = await deps.getContentQuery();
  } catch (err) {
    printError(deps.stderr, { error: 'config_error', message: err.message });
    return { exitCode: EXIT_CONFIG };
  }

  const registry = queryService.__registry;
  if (!registry || typeof registry.getCategories !== 'function') {
    printError(deps.stderr, { error: 'content_error', message: 'registry not available' });
    return { exitCode: EXIT_FAIL };
  }

  const categories = registry.getCategories();
  printJson(deps.stdout, { categories, count: categories.length });
  return { exitCode: EXIT_OK };
}

async function actionPlay(args, deps) {
  const key = args.positional[1];
  const device = args.flags.to;
  if (!key || !device) {
    deps.stderr.write('dscli content play: usage: dscli content play <source>:<id> --to <deviceId> [--shader X] [--shuffle] [--enqueue play|add] --allow-write\n');
    return { exitCode: EXIT_USAGE };
  }
  if (!deps.allowWrite) {
    printError(deps.stderr, { error: 'allow_write_required', command: 'content play', message: 'Write commands require --allow-write.' });
    return { exitCode: EXIT_USAGE };
  }

  const url = new URL(`${backendUrl()}/api/v1/device/${encodeURIComponent(device)}/load`);
  url.searchParams.set('queue', key);
  if (args.flags.shader) url.searchParams.set('shader', args.flags.shader);
  if (args.flags.shuffle) url.searchParams.set('shuffle', '1');
  if (args.flags.enqueue) url.searchParams.set('enqueue', args.flags.enqueue);

  const fetchFn = deps.fetch || globalThis.fetch;
  let response;
  try {
    response = await fetchFn(url.toString());
  } catch (err) {
    printError(deps.stderr, { error: 'backend_unreachable', url: url.toString(), message: err.message });
    return { exitCode: EXIT_BACKEND };
  }

  if (!response.ok) {
    printError(deps.stderr, { error: 'backend_unhealthy', url: url.toString(), status: response.status });
    return { exitCode: EXIT_BACKEND };
  }

  let body = {};
  try { body = await response.json(); } catch {}

  try {
    const audit = await deps.getWriteAuditor();
    await audit.log({ command: 'content', action: 'play', args: { key, device, shader: args.flags.shader ?? null, shuffle: !!args.flags.shuffle }, result: body });
  } catch {}

  printJson(deps.stdout, { ok: true, device, key, ...body });
  return { exitCode: EXIT_OK };
}

const ACTIONS = {
  search: actionSearch,
  resolve: actionResolve,
  'list-libraries': actionListLibraries,
  play: actionPlay,
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
