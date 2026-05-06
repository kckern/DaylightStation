// backend/src/3_applications/agents/framework/AgentTranscript.mjs

import crypto from 'node:crypto';
import { mkdir as fsMkdir, writeFile as fsWriteFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { safeClone } from './utils/safeClone.mjs';

/**
 * Default file-path strategy — produces the same path as the original flush() logic:
 *   {mediaDir}/logs/agents/{agentId}/{YYYY-MM-DD}/{userId}/{HHMMSS-mmm}-{turnIdShort}.json
 * @param {AgentTranscript} t
 * @returns {string}
 */
function defaultFilePathStrategy(t) {
  const day = t.startedAt.toISOString().slice(0, 10); // YYYY-MM-DD
  const iso = t.startedAt.toISOString();
  const time = iso.slice(11, 23).replace(/[:.]/g, '');      // 204215123
  const filenameTs = `${time.slice(0, 6)}-${time.slice(6, 9)}`; // 204215-123
  const turnIdShort = (t.turnId || '').slice(0, 8) || 'no-id';
  const userDir = t.userId || 'anonymous';
  return join(t.mediaDir, 'logs', 'agents', t.agentId, day, userDir, `${filenameTs}-${turnIdShort}.json`);
}

/**
 * Per-turn transcript collector for any agent run. Generalizes the
 * concierge-specific ConciergeTranscript pattern into the agent framework.
 *
 * Lifecycle:
 *   1. MastraAdapter.execute() instantiates one at the top of the call.
 *   2. Mutators capture system prompt, model, tool calls, output, errors.
 *   3. flush() writes the JSON to disk in a finally block.
 *
 * Schema: see docs/superpowers/specs/2026-05-05-agent-transcripts-design.md
 */
export class AgentTranscript {
  constructor({ agentId, userId = null, turnId = null, input, mediaDir = null, logger = console, fs: injectedFs = null, filePathStrategy = null } = {}) {
    if (!agentId) throw new Error('AgentTranscript: agentId is required');
    if (!input || typeof input !== 'object') throw new Error('AgentTranscript: input is required');

    this.agentId = agentId;
    this.userId = userId;
    this.turnId = turnId || crypto.randomUUID();

    this.startedAt = new Date();
    this.completedAt = null;
    this.status = null;

    this.input = {
      text: typeof input.text === 'string' ? input.text : '',
      context: input.context && typeof input.context === 'object' ? safeClone(input.context) : {},
    };

    this.systemPrompt = null;
    this.model = null;
    this.toolCalls = [];
    this.output = null;
    this.error = null;

    // Optional fields — only emitted in toJSON when set
    this.requestBody = null;
    this.satellite = null;

    this.mediaDir = mediaDir;
    this.logger = logger;
    this._flushed = false;

    // Injectable fs (for testing) and file-path strategy
    this._fs = injectedFs || { mkdir: fsMkdir, writeFile: fsWriteFile };
    this.filePathStrategy = filePathStrategy ?? defaultFilePathStrategy;
  }

  setSystemPrompt(text) {
    this.systemPrompt = typeof text === 'string' ? text : null;
  }

  setModel({ name, provider } = {}) {
    this.model = { name: name || 'unknown', provider: provider || 'unknown' };
  }

  /**
   * Append a tool invocation. Called by the MastraAdapter tool wrapper.
   * @param {{ name, args, result, ok, latencyMs, policyDecision? }} entry
   */
  recordTool({ name, args, result, ok, latencyMs, policyDecision } = {}) {
    const ix = this.toolCalls.length;
    const attachments = this.input?.context?.attachments;
    const entry = {
      ix,
      name,
      args: safeClone(args),
      result: result === undefined ? null : safeClone(result),
      ok: ok !== false,
      latencyMs: typeof latencyMs === 'number' ? latencyMs : null,
      ts: new Date().toISOString(),
      linkedAttachments: computeLinkedAttachments(args, attachments),
    };
    if (policyDecision !== undefined) entry.policyDecision = policyDecision;
    this.toolCalls.push(entry);
  }

  setRequestBody(body) {
    this.requestBody = body ? safeClone(body) : null;
  }

  setSatelliteSnapshot(satellite) {
    this.satellite = satellite ? safeClone(satellite) : null;
  }

  setOutput({ text = '', finishReason = 'stop', usage = null } = {}) {
    this.output = { text, finishReason, usage };
  }

  setError(err, { toolCallsBeforeError = 0 } = {}) {
    this.error = {
      message: err?.message || String(err),
      stack: err?.stack || null,
      toolCallsBeforeError,
    };
  }

  setStatus(status) {
    this.status = status;
    if (this.completedAt === null) {
      this.completedAt = new Date();
    }
  }

  get durationMs() {
    if (!this.completedAt) return null;
    return this.completedAt.getTime() - this.startedAt.getTime();
  }

  toJSON() {
    const json = {
      version: 1,
      turnId: this.turnId,
      agentId: this.agentId,
      userId: this.userId,
      startedAt: this.startedAt.toISOString(),
      completedAt: this.completedAt ? this.completedAt.toISOString() : null,
      durationMs: this.durationMs,
      status: this.status,
      input: this.input,
      systemPrompt: this.systemPrompt,
      model: this.model,
      toolCalls: this.toolCalls,
      output: this.output,
      error: this.error,
      tags: [this.agentId],
    };
    if (this.requestBody !== null) json.requestBody = this.requestBody;
    if (this.satellite !== null) json.satellite = this.satellite;
    return json;
  }

  /**
   * Write the transcript JSON to disk under
   * {mediaDir}/logs/agents/{agentId}/{YYYY-MM-DD}/{userId}/{HHMMSS-mmm}-{turnIdShort}.json
   *
   * Idempotent — calling twice is safe (subsequent calls are no-ops). Never
   * throws — failures are warned via the configured logger and swallowed
   * so the agent's user-facing response is unaffected.
   */
  async flush() {
    if (!this.mediaDir) return;
    if (this._flushed) return;

    try {
      const file = this.filePathStrategy(this);
      await this._fs.mkdir(dirname(file), { recursive: true });
      await this._fs.writeFile(file, JSON.stringify(this.toJSON(), null, 2), 'utf8');
      this._flushed = true;
    } catch (err) {
      this.logger?.warn?.('agent.transcript.flush_failed', {
        agentId: this.agentId,
        turnId: this.turnId,
        error: err?.message || String(err),
      });
    }
  }
}

/**
 * Compute which attachments (by index) appear to have driven a tool call.
 *
 * Heuristic:
 *   - period attachment: link if any args field deep-equals attachment.value
 *   - day/workout/nutrition/weight: link if args.date === attachment.date
 *     OR (args.from === args.to === attachment.date)
 *
 * @param {object} args - tool args
 * @param {Array<object>} attachments - input.context.attachments
 * @returns {number[]} indexes into attachments
 */
function computeLinkedAttachments(args, attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) return [];
  if (!args || typeof args !== 'object') return [];

  const linked = [];
  for (let i = 0; i < attachments.length; i++) {
    const a = attachments[i];

    // Period: deep-equal any args field to a.value
    if (a?.type === 'period' && a.value) {
      for (const v of Object.values(args)) {
        if (deepEqual(v, a.value)) {
          linked.push(i);
          break;
        }
      }
      continue;
    }

    // Day-anchored types
    if (['day', 'workout', 'nutrition', 'weight'].includes(a?.type) && a.date) {
      const d = a.date;
      if (args.date === d) { linked.push(i); continue; }
      if (args.from === d && args.to === d) { linked.push(i); continue; }
    }

    // metric_snapshot: link if args.metric === attachment.metric AND args.period deep-equals attachment.period
    if (a?.type === 'metric_snapshot' && a.metric && a.period) {
      if (args.metric === a.metric && deepEqual(args.period, a.period)) {
        linked.push(i);
        continue;
      }
    }
  }
  return linked;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}


export default AgentTranscript;
