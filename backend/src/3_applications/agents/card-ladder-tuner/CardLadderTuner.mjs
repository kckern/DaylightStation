// backend/src/3_applications/agents/card-ladder-tuner/CardLadderTuner.mjs
/**
 * CardLadderTuner — a tool-less agent that reads one learner × package tuning
 * digest (domain `buildTuningDigest`) and returns a structured status note and
 * proposed threshold changes. It proposes only: the brakes live in the domain
 * (`applyTuningProposal`) and the caller applies them.
 */
import { BaseAgent } from '../framework/BaseAgent.mjs';
import { systemPrompt } from './prompts/system.mjs';

export const TUNING_STATUSES = Object.freeze(['on-track', 'stuck', 'coasting', 'concern']);

// Strict-output friendly: every object key required, no extra keys.
export const TUNING_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false, required: ['status', 'notes', 'changes'],
  properties: {
    status: { type: 'string', enum: [...TUNING_STATUSES] },
    notes: { type: 'array', maxItems: 3, items: { type: 'string' } },
    changes: {
      type: 'array', maxItems: 6,
      items: {
        type: 'object', additionalProperties: false, required: ['setting', 'to', 'reason'],
        properties: { setting: { type: 'string' }, to: { type: 'number' }, reason: { type: 'string' } },
      },
    },
  },
});

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const sameKeys = (obj, keys) => Object.keys(obj).length === keys.length && keys.every((key) => Object.hasOwn(obj, key));

function invalid(why) {
  return Object.assign(new Error(`invalid tuner output: ${why}`), { code: 'AGENT_SCHEMA_INVALID' });
}

/** Checks a structured result against TUNING_SCHEMA; returns it or throws. */
export function validateTuning(out) {
  if (!isPlainObject(out) || !sameKeys(out, ['status', 'notes', 'changes'])) throw invalid('expected exactly {status, notes, changes}');
  if (!TUNING_STATUSES.includes(out.status)) throw invalid(`unknown status '${out.status}'`);
  if (!Array.isArray(out.notes) || out.notes.length > 3 || !out.notes.every((note) => typeof note === 'string')) {
    throw invalid('notes must be at most 3 strings');
  }
  if (!Array.isArray(out.changes) || out.changes.length > TUNING_SCHEMA.properties.changes.maxItems) throw invalid('changes must be a short array');
  for (const change of out.changes) {
    if (!isPlainObject(change) || !sameKeys(change, ['setting', 'to', 'reason'])
      || typeof change.setting !== 'string' || typeof change.reason !== 'string'
      || typeof change.to !== 'number' || !Number.isFinite(change.to)) {
      throw invalid('each change must be {setting: string, to: number, reason: string}');
    }
  }
  return out;
}

export class CardLadderTuner extends BaseAgent {
  static id = 'card-ladder-tuner';
  static description = 'Watches a learner\'s card-ladder days and nudges engine thresholds within grown-up bounds';

  constructor(deps = {}) {
    super({ ...deps, agentRuntime: deps.agentRuntime || deps.runtime });
    this.runtime = deps.agentRuntime || deps.runtime;
  }

  getSystemPrompt() { return systemPrompt; }

  registerTools() { /* no tools: the digest is the only input */ }

  async tune(digest) {
    const result = await this.runtime.execute({
      agent: this,
      input: JSON.stringify(digest),
      tools: [],
      systemPrompt,
      outputSchema: TUNING_SCHEMA,
      limits: { maxSteps: 1, timeoutMs: 30000 },
    });
    return validateTuning(result?.structured);
  }
}
