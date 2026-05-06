import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  useMessage,
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
} from '@assistant-ui/react';
import { useMemo } from 'react';
import { createAgentRuntime } from './runtime.js';
import { MarkdownText } from './MarkdownText.jsx';
import { ToolCallAttribution } from './ToolCallAttribution.jsx';

/**
 * Shared agent chat surface — every agent in the app renders through this
 * component. Built on @assistant-ui/react v0.12.28 primitives.
 *
 * @param {object} props
 * @param {string} props.agentId
 * @param {string} props.userId
 * @param {'light'|'overlay'} [props.variant='light']
 * @param {object} [props.style]
 * @param {object} [props.mentions]  — wired in Task 6
 */
export function AgentChatSurface({ agentId, userId, variant = 'light', style, mentions }) {
  const agentRuntime = useMemo(() => createAgentRuntime(agentId), [agentId]);

  const adapter = useMemo(() => ({
    async *run({ messages, abortSignal }) {
      const attachments = collectAttachments(messages);
      for await (const chunk of agentRuntime.runStream({ messages, userId, attachments, abortSignal })) {
        yield {
          content: chunk.content,
          metadata: {
            custom: {
              toolCalls: chunk.metadata?.toolCalls ?? [],
            },
          },
        };
      }
    },
  }), [agentRuntime, userId]);

  const runtime = useLocalRuntime(adapter);

  return (
    <div
      className={`coach-chat${variant === 'overlay' ? ' coach-chat--overlay' : ''}`}
      style={style}
    >
      <AssistantRuntimeProvider runtime={runtime}>
        <ThreadPrimitive.Root className="coach-chat__thread">
          <ThreadPrimitive.Viewport className="coach-chat__viewport">
            <ThreadPrimitive.Messages
              components={{
                UserMessage: UserMessage,
                AssistantMessage: AssistantMessage,
              }}
            />
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>

        <ComposerPrimitive.Root className="coach-chat__composer">
          <ComposerPrimitive.Input
            className="coach-chat__input"
            placeholder="Ask…"
          />
          <ComposerPrimitive.Send className="coach-chat__send" />
        </ComposerPrimitive.Root>
      </AssistantRuntimeProvider>
    </div>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="coach-chat__message coach-chat__message--user">
      <MessagePrimitive.Parts />
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="coach-chat__message coach-chat__message--assistant">
      <MessagePrimitive.Parts
        components={{
          Text: ({ text }) => <MarkdownText text={text || ''} />,
        }}
      />
      <AssistantMessageToolCalls />
    </MessagePrimitive.Root>
  );
}

function AssistantMessageToolCalls() {
  try {
    const toolCalls = useMessage((state) => state?.metadata?.custom?.toolCalls);
    return <ToolCallAttribution toolCalls={toolCalls} />;
  } catch {
    return null;
  }
}

function collectAttachments(messages) {
  const last = messages.at(-1);
  if (!last) return [];
  if (Array.isArray(last.attachments)) return last.attachments;
  if (Array.isArray(last.metadata?.attachments)) return last.metadata.attachments;
  return [];
}

export default AgentChatSurface;
