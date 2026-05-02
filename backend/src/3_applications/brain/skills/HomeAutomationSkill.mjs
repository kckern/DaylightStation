import { resolveEntity } from './_friendlyName.mjs';
import { AliasMap } from '#domains/common/AliasMap.mjs';

export class HomeAutomationSkill {
  static name = 'home_automation';

  #gateway;
  #logger;
  #config;

  constructor({ gateway, logger = console, config = {} }) {
    if (!gateway) throw new Error('HomeAutomationSkill: gateway required');
    this.#gateway = gateway;
    this.#logger = logger;
    this.#config = { friendly_name_aliases: {}, area_priority: [], ...config };
  }

  get name() { return HomeAutomationSkill.name; }
  getConfig() { return { ...this.#config }; }

  getPromptFragment(_satellite) {
    return `## Home Automation
You can control lights, switches, scenes, and scripts.
- Use \`ha_toggle_entity\` with a friendly name and \`action\` of "turn_on", "turn_off", or "toggle".
- Use \`ha_activate_scene\` with the scene name.
- Use \`ha_run_script\` with the script name.
- Use \`ha_get_state\` to check current state of one device.
Refuse if a device is not configured. Do not invent entity IDs.`;
  }

  getTools() {
    const gw = this.#gateway;
    const aliases = new AliasMap(this.#config.friendly_name_aliases ?? {});
    const log = this.#logger;

    return [
      {
        name: 'ha_toggle_entity',
        description: 'Turn on, off, or toggle an entity by friendly name (light, switch, fan, etc.).',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Friendly name of the device.' },
            action: { type: 'string', enum: ['turn_on', 'turn_off', 'toggle'], description: 'Service to call.' },
          },
          required: ['name', 'action'],
        },
        async execute({ name, action }) {
          const resolved = await resolveEntity({ name, gateway: gw, aliases });
          if (!resolved.entityId) {
            log.warn?.('brain.skill.ha.resolve_failed', { friendly_name: name, candidates: resolved.candidates ?? [] });
            return { ok: false, reason: resolved.reason, candidates: resolved.candidates };
          }
          const domain = resolved.entityId.split('.')[0];
          const result = await gw.callService(domain, action, { entity_id: resolved.entityId });
          log.info?.('brain.skill.ha.action', { tool: 'ha_toggle_entity', entity_id: resolved.entityId, ok: !!result?.ok });
          return { ok: !!result?.ok, entity_id: resolved.entityId, action, error: result?.error };
        },
      },
      {
        name: 'ha_activate_scene',
        description: 'Activate a Home Assistant scene by friendly name.',
        parameters: {
          type: 'object',
          properties: { name: { type: 'string', description: 'Friendly name of the scene.' } },
          required: ['name'],
        },
        async execute({ name }) {
          const resolved = await resolveEntity({ name, gateway: gw, aliases, domain: 'scene' });
          if (!resolved.entityId) return { ok: false, reason: resolved.reason, candidates: resolved.candidates };
          const result = await gw.activateScene(resolved.entityId);
          log.info?.('brain.skill.ha.action', { tool: 'ha_activate_scene', entity_id: resolved.entityId, ok: !!result?.ok });
          return { ok: !!result?.ok, scene: resolved.entityId, error: result?.error };
        },
      },
      {
        name: 'ha_run_script',
        description: 'Run a Home Assistant script by friendly name.',
        parameters: {
          type: 'object',
          properties: { name: { type: 'string', description: 'Friendly name of the script.' } },
          required: ['name'],
        },
        async execute({ name }) {
          const resolved = await resolveEntity({ name, gateway: gw, aliases, domain: 'script' });
          if (!resolved.entityId) return { ok: false, reason: resolved.reason, candidates: resolved.candidates };
          const result = await gw.runScript(resolved.entityId);
          log.info?.('brain.skill.ha.action', { tool: 'ha_run_script', entity_id: resolved.entityId, ok: !!result?.ok });
          return { ok: !!result?.ok, script: resolved.entityId, error: result?.error };
        },
      },
      {
        name: 'ha_get_state',
        description: 'Get current state of a device by friendly name.',
        parameters: {
          type: 'object',
          properties: { name: { type: 'string', description: 'Friendly name of the device.' } },
          required: ['name'],
        },
        async execute({ name }) {
          const resolved = await resolveEntity({ name, gateway: gw, aliases });
          if (!resolved.entityId) return { ok: false, reason: resolved.reason };
          const state = await gw.getState(resolved.entityId);
          if (!state) return { ok: false, reason: 'not_found', entity_id: resolved.entityId };
          return { ok: true, entity_id: resolved.entityId, state: state.state, attributes: state.attributes };
        },
      },
    ];
  }
}

export default HomeAutomationSkill;
