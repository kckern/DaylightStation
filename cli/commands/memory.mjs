/**
 * dscli memory — read concierge memory state.
 *
 * Actions:
 *   dscli memory get <key>   — Get value for one memory key.
 *   dscli memory list        — Dump all memory keys + values.
 *
 * Reads from the YAML-backed concierge memory store the agent uses.
 * Internal agentId/userId are 'concierge' / 'household' (set inside the
 * YamlConciergeMemoryAdapter — not configurable here).
 */

import { printJson, printError, EXIT_OK, EXIT_FAIL, EXIT_USAGE, EXIT_CONFIG } from '../_output.mjs';

const HELP = `
dscli memory — concierge memory state

Usage:
  dscli memory <action> [args]

Actions:
  get <key>    Read value for one memory key.
               Returns: { key, value }
  list         Dump all memory keys + values.
               Returns: { keys, count, values }
`.trimStart();

async function actionGet(args, deps) {
  const key = args.positional[1];
  if (!key) {
    deps.stderr.write('dscli memory get: missing required <key>\n');
    deps.stderr.write(HELP);
    return { exitCode: EXIT_USAGE };
  }

  let memory;
  try {
    memory = await deps.getMemory();
  } catch (err) {
    printError(deps.stderr, { error: 'config_error', message: err.message });
    return { exitCode: EXIT_CONFIG };
  }

  let value;
  try {
    value = await memory.get(key);
  } catch (err) {
    printError(deps.stderr, { error: 'memory_error', message: err.message });
    return { exitCode: EXIT_FAIL };
  }
  if (value === null || value === undefined) {
    printError(deps.stderr, { error: 'not_found', key });
    return { exitCode: EXIT_FAIL };
  }

  printJson(deps.stdout, { key, value });
  return { exitCode: EXIT_OK };
}

async function actionList(args, deps) {
  let memory;
  try {
    memory = await deps.getMemory();
  } catch (err) {
    printError(deps.stderr, { error: 'config_error', message: err.message });
    return { exitCode: EXIT_CONFIG };
  }

  const wm = memory.__workingMemory;
  let values = {};
  if (wm && typeof wm.load === 'function') {
    try {
      const state = await wm.load('concierge', 'household');
      if (state && typeof state.getAll === 'function') {
        const all = state.getAll();
        if (all && typeof all === 'object' && !Array.isArray(all)) {
          values = all;
        }
      }
    } catch (err) {
      printError(deps.stderr, { error: 'memory_error', message: err.message });
      return { exitCode: EXIT_FAIL };
    }
  }
  const keys = Object.keys(values);

  printJson(deps.stdout, { keys, count: keys.length, values });
  return { exitCode: EXIT_OK };
}

const ACTIONS = {
  get: actionGet,
  list: actionList,
};

export default {
  name: 'memory',
  description: 'Read concierge memory state',
  requiresBackend: false,
  async run(args, deps) {
    if (args.help) {
      deps.stdout.write(HELP);
      return { exitCode: EXIT_OK };
    }

    const action = args.positional[0];
    if (!action || !ACTIONS[action]) {
      deps.stderr.write(`dscli memory: unknown action: ${action ?? '(none)'}\n`);
      deps.stderr.write(HELP);
      return { exitCode: EXIT_USAGE };
    }

    return ACTIONS[action](args, deps);
  },
};
