import { assertSkill } from '../ports/ISkill.mjs';

export class SkillRegistry {
  #skills = new Map();
  #logger;

  constructor({ logger = console } = {}) {
    this.#logger = logger;
  }

  register(skill) {
    assertSkill(skill);
    if (this.#skills.has(skill.name)) {
      throw new Error(`SkillRegistry: skill '${skill.name}' already registered`);
    }
    this.#skills.set(skill.name, skill);
  }

  getSkillsFor(satellite) {
    return [...this.#skills.values()].filter((s) => satellite.canUseSkill(s.name));
  }

  buildToolsFor(satellite, policy, transcript = null) {
    const tools = [];
    for (const skill of this.getSkillsFor(satellite)) {
      for (const tool of skill.getTools()) {
        tools.push(this.#wrap(tool, skill, satellite, policy, transcript));
      }
    }
    return tools;
  }

  buildPromptFragmentsFor(satellite) {
    return this.getSkillsFor(satellite)
      .map((s) => s.getPromptFragment(satellite))
      .filter(Boolean)
      .join('\n\n');
  }

  #wrap(tool, skill, satellite, policy, transcript) {
    const log = this.#logger;
    return {
      ...tool,
      execute: async (params, ctx) => {
        const decision = policy.evaluateToolCall(satellite, tool.name, params);
        if (!decision.allow) {
          log.warn?.('brain.tool.policy_denied', {
            satellite_id: satellite.id,
            tool: tool.name,
            reason: decision.reason,
          });
          const denied = { ok: false, reason: `policy_denied:${decision.reason ?? 'unspecified'}` };
          transcript?.recordTool({ name: tool.name, args: params, result: denied, ok: false, latencyMs: 0 });
          return denied;
        }
        const start = Date.now();
        log.info?.('brain.tool.invoke', {
          satellite_id: satellite.id,
          tool: tool.name,
          args_shape: shapeOf(params),
        });
        try {
          const result = await tool.execute(params, { ...ctx, satellite, skill: skill.name });
          const latencyMs = Date.now() - start;
          log.info?.('brain.tool.complete', {
            satellite_id: satellite.id,
            tool: tool.name,
            ok: result?.ok !== false,
            latencyMs,
          });
          transcript?.recordTool({ name: tool.name, args: params, result, ok: result?.ok !== false, latencyMs });
          return result;
        } catch (error) {
          const latencyMs = Date.now() - start;
          log.error?.('brain.tool.error', {
            satellite_id: satellite.id,
            tool: tool.name,
            error: error.message,
            latencyMs,
          });
          const errResult = { ok: false, reason: 'error', error: error.message };
          transcript?.recordTool({ name: tool.name, args: params, result: errResult, ok: false, latencyMs });
          return errResult;
        }
      },
    };
  }
}

function shapeOf(args) {
  if (!args || typeof args !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(args)) out[k] = Array.isArray(v) ? 'array' : typeof v;
  return out;
}

export default SkillRegistry;
