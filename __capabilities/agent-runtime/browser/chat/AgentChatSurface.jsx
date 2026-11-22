import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  useMessage,
  ActionBarPrimitive,
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  unstable_useMentionAdapter,
} from '@assistant-ui/react';
import { createContext, useContext, useMemo, useEffect, useLayoutEffect, useRef } from 'react';
import { browserPreference } from '../../../../frontend/src/lib/browserPreference.js';
import { useApiResource } from '../../../../frontend/src/lib/hooks/useApiResource.js';
import "./AgentChatSurface.scss";
import { createAgentRuntime, getOrCreateThreadId } from "./runtime.js";
import { MarkdownText } from "./MarkdownText.jsx";
import { ToolCallAttribution } from "./ToolCallAttribution.jsx";

const RETRY_ATTACHMENTS_KEY = 'submittedAgentAttachments';

/**
 * Shared agent chat surface — every agent in the app renders through this
 * component. Built on @assistant-ui/react v0.12.28 primitives.
 *
 * @param {object} props
 * @param {string} props.agentId
 * @param {string} props.userId
 * @param {'light'|'overlay'} [props.variant='light']
 * @param {object} [props.style]
 * @param {object} [props.mentions]  — optional mention-popover config:
 *   { fetchUrl: string, categories: Array<{key, label, icon}>, buildAttachment: fn }
 *   When present, wraps the composer in Unstable_TriggerPopoverRoot and
 *   fetches suggestions on mount. When absent, the bare composer renders.
 */
export function useAgentConversation({ agentId, userId, onComplete, context = null, persistSession = false }) {
  const pendingMentionsRef = useRef([]);
  // Retries reuse their user-message ID; keep their context separate from newer draft mentions.
  const submittedAttachmentsRef = useRef(new Map());
  const retiredRetryMessageIdsRef = useRef(new Set());
  const contextRef = useRef(context);
  contextRef.current = context;
  const owner = useMemo(() => {
    const agentRuntime = createAgentRuntime(agentId);
    if (!persistSession) return { agentRuntime };
    const threadId = getOrCreateThreadId(agentId, userId);
    const transcript = browserPreference(`agent-session:${agentId}:${userId}:${threadId}`, [], raw => {
      const messages = JSON.parse(raw);
      return Array.isArray(messages) ? messages : null;
    }, () => sessionStorage);
    return { agentRuntime, threadId, transcript };
  }, [agentId, userId, persistSession]);
  const liveOwner = useRef(null);
  useLayoutEffect(() => {
    liveOwner.current = owner;
    return () => { liveOwner.current = null; };
  }, [owner]);
  const initialMessages = useMemo(() => owner.transcript?.read(), [owner]);

  const adapter = useMemo(() => ({
    async *run({ messages, abortSignal }) {
      const userMessage = messages.at(-1);
      const messageId = userMessage?.id;
      const hasRetainedAttachments = messageId && submittedAttachmentsRef.current.has(messageId);
      const persistedAttachments = userMessage?.metadata?.custom?.[RETRY_ATTACHMENTS_KEY];
      const hasPersistedAttachments = Array.isArray(persistedAttachments);
      const attachments = hasRetainedAttachments
        ? submittedAttachmentsRef.current.get(messageId)
        : hasPersistedAttachments
          ? persistedAttachments
          : [...collectAttachments(messages), ...pendingMentionsRef.current];
      if (!hasRetainedAttachments && !hasPersistedAttachments) pendingMentionsRef.current = [];
      if (messageId) submittedAttachmentsRef.current.set(messageId, attachments);
      let retainAttachmentsForRetry = false;
      try {
        for await (const chunk of owner.agentRuntime.runStream({ messages, userId, attachments, abortSignal, context: contextRef.current, threadId: owner.threadId })) {
          yield {
            content: chunk.content,
            metadata: {
              custom: {
                toolCalls: chunk.metadata?.toolCalls ?? [],
              },
            },
          };
        }
      } catch (error) {
        retainAttachmentsForRetry = !abortSignal?.aborted && error?.name !== 'AbortError';
        throw error;
      } finally {
        if (messageId && !retainAttachmentsForRetry) {
          submittedAttachmentsRef.current.delete(messageId);
          if (hasPersistedAttachments) retiredRetryMessageIdsRef.current.add(messageId);
        }
        if (liveOwner.current === owner) onComplete?.();
      }
    },
  }), [owner, userId, onComplete]);

  const runtime = useLocalRuntime(adapter, { initialMessages });
  useEffect(() => {
    if (!owner.transcript) return;
    return runtime.thread.subscribe(() => {
      if (runtime.thread.getState().isRunning) return;
      const currentMessages = runtime.thread.getState().messages.slice(-80);
      const currentMessageIds = new Set(currentMessages.map(message => message.id));
      const messages = currentMessages.map(message => {
        const hasSubmittedAttachments = submittedAttachmentsRef.current.has(message.id);
        const custom = { ...message.metadata?.custom };
        if (hasSubmittedAttachments) {
          custom[RETRY_ATTACHMENTS_KEY] = submittedAttachmentsRef.current.get(message.id);
        } else if (retiredRetryMessageIdsRef.current.has(message.id)) {
          delete custom[RETRY_ATTACHMENTS_KEY];
        }
        return {
          id: message.id,
          role: message.role,
          content: message.content,
          status: message.status,
          metadata: hasSubmittedAttachments || retiredRetryMessageIdsRef.current.has(message.id)
            ? { ...message.metadata, custom }
            : message.metadata,
        };
      });
      for (const id of retiredRetryMessageIdsRef.current) {
        if (!currentMessageIds.has(id)) retiredRetryMessageIdsRef.current.delete(id);
      }
      owner.transcript.write(JSON.stringify(messages));
    });
  }, [runtime, owner]);
  return { runtime, pendingMentionsRef };
}

const ConversationContext = createContext(null);

// The runtime's internal thread is mounted by its provider. Sharing the hook
// alone is insufficient: replacing the provider replaces that thread, too.
export function AgentConversationProvider({ conversation, children }) {
  return <ConversationContext.Provider value={conversation}>
    <AssistantRuntimeProvider runtime={conversation.runtime}>{children}</AssistantRuntimeProvider>
  </ConversationContext.Provider>;
}

export function AgentChatSurface(props) {
  const inherited = useContext(ConversationContext);
  const conversation = props.conversation || inherited;
  if (!conversation) return <OwnedAgentChatSurface {...props} />;
  const view = <AgentChatView {...props} conversation={conversation} />;
  return inherited === conversation ? view
    : <AgentConversationProvider conversation={conversation}>{view}</AgentConversationProvider>;
}

function OwnedAgentChatSurface(props) {
  const conversation = useAgentConversation(props);
  return <AgentConversationProvider conversation={conversation}>
    <AgentChatView {...props} conversation={conversation} />
  </AgentConversationProvider>;
}

function AgentChatView({ conversation, variant = 'light', style, mentions, starterPrompts = [] }) {
  const { pendingMentionsRef } = conversation;
  const inputRef = useRef(null);

  return (
    <div
      className={`coach-chat${variant === 'overlay' ? ' coach-chat--overlay' : ''}`}
      style={style}
    >
      <ThreadPrimitive.Root className="coach-chat__thread">
        <ThreadPrimitive.Viewport className="coach-chat__viewport">
          {starterPrompts.length ? <ThreadPrimitive.Empty><div className="coach-chat__starters">
            <p>Ask about your food log, portions, or progress.</p>
            {starterPrompts.map(prompt => <button type="button" key={prompt} onClick={() => {
              conversation.runtime.thread.composer.setText(prompt);
              inputRef.current?.focus();
            }}>{prompt}</button>)}
            <small>Choose a prompt to draft it; Send starts the conversation.</small>
          </div></ThreadPrimitive.Empty> : null}
          <ThreadPrimitive.Messages
            components={{
              UserMessage: UserMessage,
              AssistantMessage: AssistantMessage,
            }}
          />
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>

      {/* The overlay owns Escape; do not consume it to cancel/clear the
          shared composer. Mention popovers still get first refusal. */}
      {mentions
        ? <ComposerWithMentions mentions={mentions} pendingMentionsRef={pendingMentionsRef} cancelOnEscape={variant !== 'overlay'} inputRef={inputRef} />
        : <ComposerPlain cancelOnEscape={variant !== 'overlay'} inputRef={inputRef} />}
    </div>
  );
}

// ── Plain composer (no mention popover) ──────────────────────────────────────

function ComposerPlain({ cancelOnEscape, inputRef }) {
  return (
    <ComposerPrimitive.Root className="coach-chat__composer">
      <ComposerPrimitive.Input
        ref={inputRef}
        className="coach-chat__input"
        placeholder="Ask…"
        cancelOnEscape={cancelOnEscape}
      />
      <ComposerPrimitive.Send className="coach-chat__send" aria-label="Send message">Send</ComposerPrimitive.Send>
    </ComposerPrimitive.Root>
  );
}

// ── Composer with @-mention trigger popover ───────────────────────────────────

function ComposerWithMentions({ mentions, pendingMentionsRef, cancelOnEscape, inputRef }) {
  const { fetchUrl, categories, buildAttachment } = mentions;
  const { data } = useApiResource(fetchUrl, { label: 'Coach mention suggestions', retryTransient: false });
  const mentionCategories = useMemo(() => {
    if (!Array.isArray(data?.suggestions)) return [];
    const byGroup = new Map();
    for (const suggestion of data.suggestions) {
      if (!suggestion?.slug || !suggestion.label) continue;
      const key = suggestion.group || 'other';
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key).push(suggestion);
    }

    return categories
      .filter(category => byGroup.has(category.key))
      .map(category => ({
        id: category.key,
        label: category.label,
        items: byGroup.get(category.key).map(suggestion => ({
          id: `${category.key}:${suggestion.slug}`,
          type: category.key,
          label: suggestion.label,
          description: suggestion.description,
          icon: category.icon,
          metadata: buildAttachment({ ...suggestion, group: category.key }),
        })),
      }));
  }, [data, categories, buildAttachment]);

  const mention = unstable_useMentionAdapter({
    categories: mentionCategories,
    includeModelContextTools: false,
    onInserted: (item) => {
      if (item?.metadata) {
        pendingMentionsRef.current = [...pendingMentionsRef.current, item.metadata];
      }
    },
  });

  return (
    <div data-mention-popover="true">
    <ComposerPrimitive.Unstable_TriggerPopoverRoot>
      <ComposerPrimitive.Unstable_TriggerPopover
        char="@"
        adapter={mention.adapter}
        className="coach-chat__mention-popover"
      >
        {/* Directive: inserts the @label token into the composer text */}
        <ComposerPrimitive.Unstable_TriggerPopover.Directive
          formatter={mention.directive.formatter}
          onInserted={mention.directive.onInserted}
        />

        {/* Category drill-down view */}
        <ComposerPrimitive.Unstable_TriggerPopoverCategories className="coach-chat__mention-categories">
          {(cats) =>
            cats.map(cat => (
              <ComposerPrimitive.Unstable_TriggerPopoverCategoryItem
                key={cat.id}
                categoryId={cat.id}
                className="coach-chat__mention-category"
              >
                {cat.label}
              </ComposerPrimitive.Unstable_TriggerPopoverCategoryItem>
            ))
          }
        </ComposerPrimitive.Unstable_TriggerPopoverCategories>

        {/* Back button (shown in item drill-down view) */}
        <ComposerPrimitive.Unstable_TriggerPopoverBack className="coach-chat__mention-back">
          ← Back
        </ComposerPrimitive.Unstable_TriggerPopoverBack>

        {/* Item list view */}
        <ComposerPrimitive.Unstable_TriggerPopoverItems className="coach-chat__mention-items">
          {(items) =>
            items.map((item, idx) => (
              <ComposerPrimitive.Unstable_TriggerPopoverItem
                key={item.id}
                item={item}
                index={idx}
                className="coach-chat__mention-item"
              >
                {item.label}
              </ComposerPrimitive.Unstable_TriggerPopoverItem>
            ))
          }
        </ComposerPrimitive.Unstable_TriggerPopoverItems>
      </ComposerPrimitive.Unstable_TriggerPopover>

      <ComposerPrimitive.Root className="coach-chat__composer">
        <ComposerPrimitive.Input
          ref={inputRef}
          className="coach-chat__input"
          placeholder="Ask… (type @ to mention)"
          cancelOnEscape={cancelOnEscape}
        />
        <ComposerPrimitive.Send className="coach-chat__send" aria-label="Send message">Send</ComposerPrimitive.Send>
      </ComposerPrimitive.Root>
    </ComposerPrimitive.Unstable_TriggerPopoverRoot>
    </div>
  );
}

// ── Message sub-components ────────────────────────────────────────────────────

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
      <MessagePrimitive.Error>
        <div className="coach-chat__message-error" role="alert">
          <span>The reply didn’t finish.</span>
          <ActionBarPrimitive.Reload className="coach-chat__retry">Retry reply</ActionBarPrimitive.Reload>
        </div>
      </MessagePrimitive.Error>
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
