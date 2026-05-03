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
  resolve "<query>"    Friendly-name → entity_id matcher.
                       Returns: { entity_id, friendly_name, state, area_id }
  toggle <name|entity_id> <on|off> --allow-write
                       Turn a light/switch on or off. Friendly names resolved
                       via listAllStates(). Audited.
  call-service <domain> <service> [entity_id] [--data JSON] --allow-write
                       Call any HA service directly. --data is parsed as JSON
                       and merged with entity_id (if provided). Audited.

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

async function actionResolve(args, deps) {
  const query = args.positional.slice(1).join(' ').trim();
  if (!query) {
    deps.stderr.write('dscli ha resolve: missing required <query>\n');
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

  let states;
  try {
    states = await gateway.listAllStates();
  } catch (err) {
    printError(deps.stderr, { error: 'ha_error', message: err.message });
    return { exitCode: EXIT_FAIL };
  }

  const needle = query.toLowerCase();
  let match = states.find((s) => s.attributes?.friendly_name?.toLowerCase() === needle);
  if (!match) {
    match = states.find((s) => s.attributes?.friendly_name?.toLowerCase().includes(needle));
  }

  if (!match) {
    printError(deps.stderr, { error: 'not_found', query });
    return { exitCode: EXIT_FAIL };
  }

  printJson(deps.stdout, {
    entity_id: match.entityId,
    friendly_name: match.attributes?.friendly_name ?? null,
    state: match.state,
    area_id: match.attributes?.area_id ?? match.attributes?.area ?? null,
  });
  return { exitCode: EXIT_OK };
}

async function actionToggle(args, deps) {
  // Last positional must be on|off; everything between [1] and [-1] is the name/entity_id
  const positional = args.positional.slice(1);
  if (positional.length < 2) {
    deps.stderr.write('dscli ha toggle: usage: dscli ha toggle <name|entity_id> <on|off> --allow-write\n');
    return { exitCode: EXIT_USAGE };
  }
  const desiredState = positional[positional.length - 1].toLowerCase();
  if (desiredState !== 'on' && desiredState !== 'off') {
    deps.stderr.write(`dscli ha toggle: state must be 'on' or 'off', got: ${desiredState}\n`);
    return { exitCode: EXIT_USAGE };
  }
  const target = positional.slice(0, -1).join(' ');

  if (!deps.allowWrite) {
    printError(deps.stderr, {
      error: 'allow_write_required',
      command: 'ha toggle',
      message: 'Write commands require the --allow-write flag.',
    });
    return { exitCode: EXIT_USAGE };
  }

  let gateway;
  try {
    gateway = await deps.getHaGateway();
  } catch (err) {
    printError(deps.stderr, { error: 'config_error', message: err.message });
    return { exitCode: EXIT_CONFIG };
  }

  // Resolve entity_id: direct if it has a dot; otherwise fuzzy-resolve
  let entityId = target;
  if (!/^[a-z_]+\.[a-z0-9_]+$/i.test(target)) {
    let states;
    try {
      states = await gateway.listAllStates();
    } catch (err) {
      printError(deps.stderr, { error: 'ha_error', message: err.message });
      return { exitCode: EXIT_FAIL };
    }
    const needle = target.toLowerCase();
    const match = states.find((s) => s.attributes?.friendly_name?.toLowerCase() === needle)
                  || states.find((s) => s.attributes?.friendly_name?.toLowerCase().includes(needle));
    if (!match) {
      printError(deps.stderr, { error: 'not_found', query: target });
      return { exitCode: EXIT_FAIL };
    }
    entityId = match.entityId;
  }

  const domain = entityId.split('.')[0];
  const service = desiredState === 'on' ? 'turn_on' : 'turn_off';

  let result;
  try {
    result = await gateway.callService(domain, service, { entity_id: entityId });
  } catch (err) {
    printError(deps.stderr, { error: 'ha_error', message: err.message });
    return { exitCode: EXIT_FAIL };
  }

  // Best-effort audit log
  try {
    const audit = await deps.getWriteAuditor();
    await audit.log({
      command: 'ha',
      action: 'toggle',
      args: { entity_id: entityId, state: desiredState },
      result,
    });
  } catch { /* logging failures don't fail the command */ }

  printJson(deps.stdout, { ok: result?.ok ?? true, entity_id: entityId, state: desiredState, result });
  return { exitCode: EXIT_OK };
}

async function actionCallService(args, deps) {
  const domain = args.positional[1];
  const service = args.positional[2];
  const entityId = args.positional[3] || null;
  const dataJson = args.flags.data;

  if (!domain || !service) {
    deps.stderr.write('dscli ha call-service: usage: dscli ha call-service <domain> <service> [entity_id] [--data JSON] --allow-write\n');
    return { exitCode: EXIT_USAGE };
  }
  if (!deps.allowWrite) {
    printError(deps.stderr, { error: 'allow_write_required', command: 'ha call-service', message: 'Write commands require --allow-write.' });
    return { exitCode: EXIT_USAGE };
  }

  let serviceData = {};
  if (dataJson) {
    try {
      serviceData = JSON.parse(dataJson);
    } catch (err) {
      deps.stderr.write(`dscli ha call-service: --data is not valid JSON: ${err.message}\n`);
      return { exitCode: EXIT_USAGE };
    }
  }
  if (entityId) serviceData.entity_id = entityId;

  let gateway;
  try {
    gateway = await deps.getHaGateway();
  } catch (err) {
    printError(deps.stderr, { error: 'config_error', message: err.message });
    return { exitCode: EXIT_CONFIG };
  }

  let result;
  try {
    result = await gateway.callService(domain, service, serviceData);
  } catch (err) {
    printError(deps.stderr, { error: 'ha_error', message: err.message });
    return { exitCode: EXIT_FAIL };
  }

  try {
    const audit = await deps.getWriteAuditor();
    await audit.log({ command: 'ha', action: 'call-service', args: { domain, service, data: serviceData }, result });
  } catch { /* */ }

  printJson(deps.stdout, { ok: result?.ok ?? true, domain, service, data: serviceData, result });
  return { exitCode: EXIT_OK };
}

const ACTIONS = {
  state: actionState,
  'list-devices': actionListDevices,
  'list-areas': actionListAreas,
  resolve: actionResolve,
  toggle: actionToggle,
  'call-service': actionCallService,
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
