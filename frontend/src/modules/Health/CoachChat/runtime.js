// frontend/src/modules/Health/CoachChat/runtime.js
/**
 * Health-coach chat-model adapter for assistant-ui's LocalRuntime.
 *
 * Posts the user's latest message + accumulated attachments to
 * /api/v1/agents/health-coach/run. Returns the assistant response
 * shaped for assistant-ui (content array + metadata).
 */
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

export default healthCoachChatModel;
