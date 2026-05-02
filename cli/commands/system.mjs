/**
 * dscli system — system-level operations against the running backend.
 *
 * Actions:
 *   dscli system health   — Check backend reachability and version.
 *
 * The backend URL defaults to http://localhost:3111 (matching the configured
 * app port). Override with DSCLI_BACKEND_URL.
 */

import { printJson, printError, EXIT_OK, EXIT_USAGE, EXIT_BACKEND } from '../_output.mjs';

const HELP = `
dscli system — system operations

Usage:
  dscli system <action> [flags]

Actions:
  health    Check backend reachability + version
            Returns: { ok, backend: { reachable, status, version } }

Environment:
  DSCLI_BACKEND_URL    Base URL of the running backend (default: http://localhost:3111)
`.trimStart();

function backendUrl() {
  return process.env.DSCLI_BACKEND_URL || 'http://localhost:3111';
}

async function actionHealth(args, deps) {
  const url = backendUrl() + '/api/v1/status';
  const fetchFn = deps.fetch || globalThis.fetch;

  let response;
  try {
    response = await fetchFn(url);
  } catch (err) {
    printError(deps.stderr, { error: 'backend_unreachable', url, message: err.message });
    return { exitCode: EXIT_BACKEND };
  }

  if (!response.ok) {
    printError(deps.stderr, { error: 'backend_unhealthy', url, status: response.status });
    return { exitCode: EXIT_BACKEND };
  }

  let body = {};
  try {
    body = await response.json();
  } catch {
    // Some endpoints return text; tolerate that.
  }

  printJson(deps.stdout, {
    ok: true,
    backend: {
      reachable: true,
      status: response.status,
      url,
      version: body.version ?? body.commit ?? null,
      ...body,
    },
  });
  return { exitCode: EXIT_OK };
}

const ACTIONS = {
  health: actionHealth,
};

export default {
  name: 'system',
  description: 'System operations: health',
  requiresBackend: true,
  async run(args, deps) {
    if (args.help) {
      deps.stdout.write(HELP);
      return { exitCode: EXIT_OK };
    }

    const action = args.positional[0];
    if (!action || !ACTIONS[action]) {
      deps.stderr.write(`dscli system: unknown action: ${action ?? '(none)'}\n`);
      deps.stderr.write(HELP);
      return { exitCode: EXIT_USAGE };
    }

    return ACTIONS[action](args, deps);
  },
};
