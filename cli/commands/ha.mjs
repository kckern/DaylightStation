/**
 * dscli ha — Home Assistant operations.
 *
 * Actions:
 *   dscli ha state <entity_id>   — Get current state + attributes for one entity.
 *
 * Auth + base URL come from the household's homeassistant integration
 * (data/household/config/integrations.yml + data/household/auth/homeassistant.yml
 * + data/system/config/services.yml).
 */

import { printJson, printError, EXIT_OK, EXIT_FAIL, EXIT_USAGE, EXIT_CONFIG } from '../_output.mjs';

const HELP = `
dscli ha — Home Assistant operations

Usage:
  dscli ha <action> [args] [flags]

Actions:
  state <entity_id>    Get current state + attributes
                       Returns: { entity_id, state, attributes, last_changed }

Examples:
  dscli ha state light.office_main
  dscli ha state binary_sensor.front_door
`.trimStart();

/**
 * `dscli ha state <entity_id>` — get current state via the home automation port.
 *
 * `gateway` is an IHomeAutomationGateway (port), not a concrete adapter. We only
 * call port methods (getState here) so the command stays provider-agnostic.
 *
 * @param {{ positional: string[], flags: Record<string, string|boolean> }} args
 * @param {Object} deps - getHaGateway() returns Promise<IHomeAutomationGateway>
 */
async function actionState(args, deps) {
  const entityId = args.positional[1];
  if (!entityId) {
    deps.stderr.write('dscli ha state: missing required <entity_id>\n');
    deps.stderr.write(HELP);
    return { exitCode: EXIT_USAGE };
  }

  let gateway;
  try {
    gateway = await deps.getHaGateway();
  } catch (err) {
    printError(deps.stderr, { error: 'config_error', message: err.message });
    return { exitCode: EXIT_CONFIG };
  }

  const state = await gateway.getState(entityId);
  if (!state) {
    printError(deps.stderr, { error: 'not_found', entity_id: entityId });
    return { exitCode: EXIT_FAIL };
  }

  printJson(deps.stdout, {
    entity_id: state.entityId,
    state: state.state,
    attributes: state.attributes,
    last_changed: state.lastChanged ?? null,
  });
  return { exitCode: EXIT_OK };
}

const ACTIONS = {
  state: actionState,
};

export default {
  name: 'ha',
  description: 'Home Assistant entity state',
  requiresBackend: false,
  async run(args, deps) {
    if (args.help) {
      deps.stdout.write(HELP);
      return { exitCode: EXIT_OK };
    }

    const action = args.positional[0];
    if (!action || !ACTIONS[action]) {
      deps.stderr.write(`dscli ha: unknown action: ${action ?? '(none)'}\n`);
      deps.stderr.write(HELP);
      return { exitCode: EXIT_USAGE };
    }

    return ACTIONS[action](args, deps);
  },
};
