/**
 * IChatCompletionRunner — what BrainApplication exposes outward.
 *   runChat({ satellite, messages, tools?, conversationId? }): Promise<{
 *     content: string,
 *     toolCalls: Array,
 *     usage: { promptTokens, completionTokens, totalTokens }
 *   }>
 *   streamChat({ satellite, messages, tools?, conversationId? }): AsyncIterable<ChatChunk>
 */
export function isChatCompletionRunner(obj) {
  return !!obj && typeof obj.runChat === 'function' && typeof obj.streamChat === 'function';
}

export function assertChatCompletionRunner(obj) {
  if (!isChatCompletionRunner(obj)) throw new Error('Object does not implement IChatCompletionRunner');
}

export default { isChatCompletionRunner, assertChatCompletionRunner };
