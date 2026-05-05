// frontend/src/modules/Health/CoachChat/index.jsx
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
} from '@assistant-ui/react';
import { useMemo } from 'react';
import './CoachChat.scss';
import { healthCoachChatModel } from './runtime.js';
import { MENTION_CATEGORIES, fetchSuggestions, buildAttachment } from './mentions/index.js';
import { Chip } from './chips/index.js';

/**
 * Health-coach chat surface.
 *
 * Built on assistant-ui v0.x primitives (ThreadPrimitive, ComposerPrimitive,
 * MessagePrimitive). The plan's `Thread` and `Composer` named exports are not
 * present in v0.12.28 — the primitives namespaces are the correct API.
 *
 * @param {{ userId: string, style?: object }} props
 */
export function CoachChat({ userId, style }) {
  const adapter = useMemo(() => ({
    async run({ messages, abortSignal }) {
      const attachments = collectAttachments(messages);
      return healthCoachChatModel.run({
        messages,
        userId,
        attachments,
        abortSignal,
      });
    },
  }), [userId]);

  const runtime = useLocalRuntime(adapter);

  // Mention configuration shape — the actual wiring into the composer
  // depends on the installed assistant-ui version. In v0.12.28 the
  // TriggerPopover primitives (Unstable_*) are the hook-in point;
  // for v1 we expose the config object here so Task 13 can wire it in.
  const mentionConfig = useMemo(() => ({
    triggers: MENTION_CATEGORIES.map(c => ({
      key: c.key,
      prefix: c.triggerPrefix,
      label: c.label,
      onSearch: async (prefix) => {
        const items = await fetchSuggestions({ category: c.key, prefix, userId });
        return items.map(s => ({
          id: `${c.key}:${s.slug}`,
          label: s.label,
          payload: buildAttachment(s),
        }));
      },
    })),
    fallback: {
      onSearch: async (prefix) => {
        const items = await fetchSuggestions({ category: null, prefix, userId });
        return items.map(s => ({
          id: `${s.group}:${s.slug}`,
          label: s.label,
          payload: buildAttachment({ ...s, activeCategory: s.group }),
        }));
      },
    },
    renderChip: ({ payload }) => <Chip label={payload.label} chipKey={payload.type} />,
  }), [userId]);

  return (
    <div className="coach-chat" style={style}>
      <AssistantRuntimeProvider runtime={runtime}>
        {/* Message thread */}
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

        {/* Composer */}
        <ComposerPrimitive.Root className="coach-chat__composer">
          <ComposerPrimitive.Input
            className="coach-chat__input"
            placeholder="Ask your health coach… (type @ to mention a period or metric)"
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
      <MessagePrimitive.Parts />
    </MessagePrimitive.Root>
  );
}

function collectAttachments(messages) {
  const last = messages.at(-1);
  if (!last) return [];
  if (Array.isArray(last.attachments)) return last.attachments;
  if (Array.isArray(last.metadata?.attachments)) return last.metadata.attachments;
  return [];
}

export default CoachChat;
