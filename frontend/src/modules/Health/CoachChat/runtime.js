// frontend/src/modules/Health/CoachChat/runtime.js
/**
 * Health-coach chat-model adapter for assistant-ui's LocalRuntime.
 *
 * Posts the user's latest message + accumulated attachments to
 * /api/v1/agents/health-coach/run. Returns the assistant response
 * shaped for assistant-ui (content array + metadata).
 */
import { parseSSE } from '../../../lib/sse/parseSSE.js';

export const healthCoachChatModel = {
  /**
   * @param {object} args
   * @param {Array<{role,content}>} args.messages — assistant-ui message history
   * @param {string} args.userId
   * @param {Array<object>} [args.attachments] — health-mention attachments
   * @returns {Promise<{ role:'assistant', content:[{type:'text',text:string}], metadata?:object }>}
   */
  async run({ messages, userId, attachments = [] }) {
    const last = messages.at(-1);
    const text = extractText(last);

    const res = await fetch('/api/v1/agents/health-coach/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: text,
        context: { userId, attachments },
      }),
    });

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
};

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

healthCoachChatModel.runStream = async function* runStream({ messages, userId, attachments = [], abortSignal }) {
  const last = messages.at(-1);
  const text = (typeof last?.content === 'string')
    ? last.content
    : (Array.isArray(last?.content) ? last.content.filter(p => p?.type === 'text').map(p => p.text).join('\n') : '');

  const res = await fetch('/api/v1/agents/health-coach/run-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: text, context: { userId, attachments } }),
    signal: abortSignal,
  });

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
      toolCalls.push({
        toolName: event.toolName,
        args: event.args,
        status: 'running',
      });
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
};

export default healthCoachChatModel;
