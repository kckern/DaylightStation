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
  list-devices [--domain X] [--area Y]
                       List entities, optionally filtered.
                       Returns: { devices, count }
  list-areas           List unique areas with device counts.
                       Returns: { areas, count }

Examples:
  dscli ha state light.office_main
  dscli ha state binary_sensor.front_door
  dscli ha list-devices --domain light
  dscli ha list-devices --area office
  dscli ha list-devices --domain switch --area kitchen
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

  let state;
  try {
    state = await gateway.getState(entityId);
  } catch (err) {
    printError(deps.stderr, { error: 'ha_error', message: err.message });
    return { exitCode: EXIT_FAIL };
  }
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

async function actionListDevices(args, deps) {
  let gateway;
  try {
    gateway = await deps.getHaGateway();
  } catch (err) {
    printError(deps.stderr, { error: 'config_error', message: err.message });
    return { exitCode: EXIT_CONFIG };
  }

  let states;
  try {
    states = await gateway.listAllStates();
  } catch (err) {
    printError(deps.stderr, { error: 'ha_error', message: err.message });
    return { exitCode: EXIT_FAIL };
  }

  const domainFilter = args.flags.domain;
  const areaFilter = args.flags.area;

  let filtered = states;
  if (domainFilter) {
    filtered = filtered.filter((s) => s.entityId.startsWith(domainFilter + '.'));
  }
  if (areaFilter) {
    filtered = filtered.filter((s) => s.attributes?.area_id === areaFilter || s.attributes?.area === areaFilter);
  }

  const devices = filtered.map((s) => ({
    entity_id: s.entityId,
    state: s.state,
    friendly_name: s.attributes?.friendly_name ?? null,
    area_id: s.attributes?.area_id ?? s.attributes?.area ?? null,
    domain: s.entityId.split('.')[0],
  }));

  printJson(deps.stdout, { devices, count: devices.length });
  return { exitCode: EXIT_OK };
}

async function actionListAreas(args, deps) {
  let gateway;
  try {
    gateway = await deps.getHaGateway();
  } catch (err) {
    printError(deps.stderr, { error: 'config_error', message: err.message });
    return { exitCode: EXIT_CONFIG };
  }

  let states;
  try {
    states = await gateway.listAllStates();
  } catch (err) {
    printError(deps.stderr, { error: 'ha_error', message: err.message });
    return { exitCode: EXIT_FAIL };
  }

  const counts = new Map();
  for (const s of states) {
    const areaId = s.attributes?.area_id ?? s.attributes?.area;
    if (!areaId) continue;
    counts.set(areaId, (counts.get(areaId) ?? 0) + 1);
  }
  const areas = Array.from(counts.entries())
    .map(([area_id, device_count]) => ({ area_id, device_count }))
    .sort((a, b) => a.area_id.localeCompare(b.area_id));

  printJson(deps.stdout, { areas, count: areas.length });
  return { exitCode: EXIT_OK };
}

const ACTIONS = {
  state: actionState,
  'list-devices': actionListDevices,
  'list-areas': actionListAreas,
};

export default {
  name: 'ha',
  description: 'Home Assistant entity state and listing',
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
