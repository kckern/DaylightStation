import { Stack } from '@mantine/core';
import { ChatThread } from './ChatThread.jsx';
import { ChatInput } from './ChatInput.jsx';
import { useChatEngine } from './useChatEngine.js';

/**
 * Generic chat panel — composable container for agent conversations.
 *
 * @param {Object} props
 * @param {string} props.agentId - Agent to chat with
 * @param {string} [props.userId] - User identifier
 * @param {Function} [props.onAction] - Handler for action button clicks
 * @param {Function} [props.onFeedback] - Handler for feedback (positive/negative)
 * @param {string} [props.placeholder] - Input placeholder text
 * @param {Object} [props.style] - Container style overrides
 */
export function ChatPanel({ agentId, userId, onAction, onFeedback, placeholder, style }) {
  const { messages, loading, error, send, handleAction } = useChatEngine({
    agentId,
    onAction,
    userId,
  });

  return (
    <Stack gap={0} style={{ height: '100%', ...style }}>
      <ChatThread
        messages={messages}
        onAction={handleAction}
        onFeedback={onFeedback}
      />
      {error && (
        <div style={{ padding: '0.5rem 1rem', color: 'var(--mantine-color-red-6)', fontSize: '0.8rem' }}>
          {error}
        </div>
      )}
      <ChatInput onSend={send} loading={loading} placeholder={placeholder} />
    </Stack>
  );
}
