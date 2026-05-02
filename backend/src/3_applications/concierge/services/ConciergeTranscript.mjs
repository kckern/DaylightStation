import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';

/**
 * Per-request transcript collector. The translator creates one when a request
 * lands, threads it through runChat/streamChat into ConciergeAgent and the
 * SkillRegistry tool wrappers, and calls flush() when the request ends.
 *
 * One JSON file per turn is written to:
 *   {mediaLogsDir}/concierge/YYYY-MM-DD/{satellite}/{ts}-{reqid}.json
 *
 * Each file captures: request body, full assistant content, every tool
 * invocation (name + args + result + latency), final status, latency.
 */
export class ConciergeTranscript {
  constructor({ satellite, request, mediaLogsDir, logger = console }) {
    this.id = crypto.randomUUID();
    this.startedAt = new Date();
    this.satellite = satellite;
    this.request = request;        // { messages, model, stream, conversation_id }
    this.mediaLogsDir = mediaLogsDir;
    this.logger = logger;

    this.toolInvocations = [];     // { name, args, result, ok, latencyMs, ts }
    this.assistantText = '';
    this.finishReason = null;
    this.status = null;
    this.errorMessage = null;
    this.usage = null;
  }

  appendAssistantText(text) {
    if (typeof text === 'string' && text) this.assistantText += text;
  }

  recordTool({ name, args, result, ok, latencyMs, policyDecision = null }) {
    this.toolInvocations.push({
      name,
      args: safeClone(args),
      result: safeClone(result),
      ok: ok !== false,
      latencyMs: latencyMs ?? null,
      policyDecision: policyDecision ? safeClone(policyDecision) : null,
      ts: new Date().toISOString(),
    });
  }

  finishOk({ status = 200, finishReason = 'stop', usage = null } = {}) {
    this.status = status;
    this.finishReason = finishReason;
    this.usage = usage;
  }

  finishError({ status = 502, message = 'unknown_error' }) {
    this.status = status;
    this.errorMessage = message;
  }

  toJSON() {
    return {
      id: this.id,
      startedAt: this.startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      latencyMs: Date.now() - this.startedAt.getTime(),
      satellite: this.satellite ? {
        id: this.satellite.id,
        area: this.satellite.area,
        allowedSkills: this.satellite.allowedSkills,
      } : null,
      request: this.request,
      response: {
        status: this.status,
        finishReason: this.finishReason,
        content: this.assistantText,
        usage: this.usage,
        error: this.errorMessage,
      },
      toolInvocations: this.toolInvocations,
    };
  }

  async flush() {
    if (!this.mediaLogsDir) return;
    try {
      const day = this.startedAt.toISOString().slice(0, 10); // YYYY-MM-DD
      const satId = this.satellite?.id || 'unknown';
      const ts = this.startedAt.toISOString().replace(/[:.]/g, '-');
      const file = join(this.mediaLogsDir, 'concierge', day, satId, `${ts}-${this.id}.json`);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(this.toJSON(), null, 2), 'utf8');
    } catch (err) {
      this.logger.warn?.('concierge.transcript.flush_failed', { error: err.message, id: this.id });
    }
  }
}

function safeClone(v) {
  if (v === undefined || v === null) return v;
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return String(v);
  }
}

export default ConciergeTranscript;
