/**
 * dscli system — system-level operations against the running backend.
 *
 * Actions:
 *   dscli system health   — Check backend reachability and version.
 *
 * The backend URL defaults to http://localhost:3111 (matching the configured
 * app port). Override with DSCLI_BACKEND_URL.
 */

import { printJson, printError, EXIT_OK, EXIT_FAIL, EXIT_USAGE, EXIT_CONFIG, EXIT_BACKEND } from '../_output.mjs';

const HELP = `
dscli system — system operations

Usage:
  dscli system <action> [args] [flags]

Actions:
  health                 Check backend reachability + version
                         Returns: { ok, backend: { reachable, status, version } }
  config <namespace>     Dump a config namespace as JSON.
                         Namespaces: system | devices | integrations | <appName>
                         Returns: { namespace, config }

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
      ...body,
      reachable: true,
      status: response.status,
      url,
      version: body.version ?? body.commit ?? null,
    },
  });
  return { exitCode: EXIT_OK };
}

async function actionConfig(args, deps) {
  const namespace = args.positional[1];
  if (!namespace) {
    deps.stderr.write('dscli system config: missing required <namespace>\n');
    deps.stderr.write(HELP);
    return { exitCode: EXIT_USAGE };
  }

  let cfg;
  try {
    cfg = await deps.getConfigService();
  } catch (err) {
    printError(deps.stderr, { error: 'config_error', message: err.message });
    return { exitCode: EXIT_CONFIG };
  }

  let config;
  switch (namespace) {
    case 'system':
      config = {
        dataDir: cfg.getDataDir(),
        mediaDir: cfg.getMediaDir(),
        timezone: cfg.getTimezone?.() ?? null,
      };
      break;
    case 'devices':
      config = cfg.getHouseholdDevices?.() ?? null;
      break;
    case 'integrations':
      config = cfg.getIntegrationsConfig?.() ?? null;
      break;
    default:
      // Catch-all: assume namespace is an app name.
      config = cfg.getHouseholdAppConfig?.(null, namespace) ?? null;
  }

  if (config === null || config === undefined) {
    printError(deps.stderr, { error: 'not_found', namespace });
    return { exitCode: EXIT_FAIL };
  }

  printJson(deps.stdout, { namespace, config });
  return { exitCode: EXIT_OK };
}

const ACTIONS = {
  health: actionHealth,
  config: actionConfig,
};

export default {
  name: 'system',
  description: 'System operations: health, config',
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
