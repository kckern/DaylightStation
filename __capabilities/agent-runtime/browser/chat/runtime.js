// frontend/src/modules/Agent/runtime.js
/**
 * Agent runtime factory for assistant-ui's LocalRuntime.
 *
 * Returns a chat-model adapter that hits /api/v1/agents/{agentId}/run
 * and /run-stream. The shape exactly matches assistant-ui's contract:
 * { role, content: [{type, text}], metadata: { toolCalls } }.
 *
 * @param {string} agentId — backend agent id (e.g. 'health-coach', 'lifeplan-guide')
 * @returns {{ run: Function, runStream: AsyncGeneratorFunction }}
 */
import { daylightApiResponse } from '../../../../frontend/src/lib/api.mjs';
import { browserPreference } from '../../../../frontend/src/lib/browserPreference.js';
import { parseSSE } from "../../../../frontend/src/lib/sse/parseSSE.js";

// ---------------------------------------------------------------------------
// Thread ID helpers — stable localStorage-backed key per (agentId, userId)
// ---------------------------------------------------------------------------

const THREAD_PREFIX = 'daylight-station:agent-thread:';

const threadPreference = (agentId, userId) => browserPreference(`${THREAD_PREFIX}${agentId}:${userId}`, null, value => value || null);

export function getOrCreateThreadId(agentId, userId) {
  if (!agentId || !userId) return null;
  const preference = threadPreference(agentId, userId);
  const existing = preference.read();
  if (existing) return existing;
  preference.write(`t-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  // The tab transcript can fall back to the same null thread on reload when
  // the browser will not save the generated ID.
  return preference.read();
}

export function resetThread(agentId, userId) {
  if (!agentId || !userId) return;
  threadPreference(agentId, userId).clear();
}

export function createAgentRuntime(agentId) {
  const runUrl = `/api/v1/agents/${agentId}/run`;
  const streamUrl = `/api/v1/agents/${agentId}/run-stream`;

  function submit(url, messages, userId, attachments, threadId, context, signal) {
    return daylightApiResponse(url, {
      method: 'POST',
      signal,
      data: {
        input: extractText(messages.at(-1)),
        context: { ...context, userId, attachments },
        messages: serializeMessages(messages),
        threadId,
      },
    });
  }

  return {
    /**
     * @param {object} args
     * @param {Array<{role,content}>} args.messages
     * @param {string} args.userId
     * @param {Array<object>} [args.attachments]
     */
    async run({ messages, userId, attachments = [] }) {
      const res = await submit(runUrl, messages, userId, attachments, getOrCreateThreadId(agentId, userId));

      if (!res.ok) {
        throw new Error(`Agent run failed: ${res.status} ${res.statusText || ''}`.trim());
      }

      const data = await res.json();
      return {
        role: 'assistant',
        content: [{ type: 'text', text: data.output || '' }],
        metadata: { toolCalls: data.toolCalls || [] },
      };
    },

    async *runStream({ messages, userId, attachments = [], abortSignal, context = null, threadId = getOrCreateThreadId(agentId, userId) }) {
      const res = await submit(streamUrl, messages, userId, attachments, threadId, context, abortSignal);

      if (!res.ok || !res.body) {
        throw new Error(`Agent stream failed: ${res.status} ${res.statusText || ''}`.trim());
      }

      let assistantText = '';
      const toolCalls = [];

      for await (const event of parseSSE(res.body)) {
        if (event.type === 'text-delta') {
          assistantText += event.text || '';
          yield {
            role: 'assistant',
            content: [{ type: 'text', text: assistantText }],
            metadata: { toolCalls: toolCalls.slice() },
          };
        } else if (event.type === 'tool-start') {
          toolCalls.push({ toolName: event.toolName, args: event.args, status: 'running' });
          yield {
            role: 'assistant',
            content: [{ type: 'text', text: assistantText }],
            metadata: { toolCalls: toolCalls.slice() },
          };
        } else if (event.type === 'tool-end') {
          const inflight = toolCalls.find(t => t.toolName === event.toolName && t.status === 'running');
          if (inflight) {
            inflight.status = 'done';
            inflight.result = event.result;
            inflight.latencyMs = event.latencyMs ?? 0;
          } else {
            toolCalls.push({
              toolName: event.toolName,
              result: event.result,
              status: 'done',
              latencyMs: event.latencyMs ?? 0,
            });
          }
          yield {
            role: 'assistant',
            content: [{ type: 'text', text: assistantText }],
            metadata: { toolCalls: toolCalls.slice() },
          };
        } else if (event.type === 'finish') {
          yield {
            role: 'assistant',
            content: [{ type: 'text', text: assistantText }],
            metadata: { toolCalls: toolCalls.slice(), finishReason: event.reason, usage: event.usage },
          };
        } else if (event.type === 'done') {
          return;
        } else if (event.type === 'error') {
          throw new Error(event.message || 'agent stream error');
        }
      }
    },
  };
}

function extractText(msg) {
  if (!msg) return '';
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter(p => p?.type === 'text')
      .map(p => p.text)
      .join('\n');
  }
  return '';
}

const VALID_ROLES = new Set(['user', 'assistant', 'system']);
const MAX_MESSAGES = 20;

function messageContentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(p => p && typeof p === 'object' && p.type === 'text' && typeof p.text === 'string')
      .map(p => p.text)
      .join('');
  }
  return null;
}

function serializeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  const out = [];
  for (const m of messages) {
    if (!m || !VALID_ROLES.has(m.role)) continue;
    const text = messageContentText(m.content);
    if (typeof text !== 'string' || text.length === 0) continue;
    out.push({ role: m.role, content: text });
  }
  return out.length > MAX_MESSAGES ? out.slice(out.length - MAX_MESSAGES) : out;
}

export default createAgentRuntime;
