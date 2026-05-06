import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  useMessage,
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  unstable_useMentionAdapter,
} from '@assistant-ui/react';
import { useMemo, useEffect, useRef, useState } from 'react';
import './AgentChatSurface.scss';
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
 * @param {object} [props.mentions]  — optional mention-popover config:
 *   { fetchUrl: string, categories: Array<{key, label, icon}>, buildAttachment: fn }
 *   When present, wraps the composer in Unstable_TriggerPopoverRoot and
 *   fetches suggestions on mount. When absent, the bare composer renders.
 */
export function AgentChatSurface({ agentId, userId, variant = 'light', style, mentions }) {
  const agentRuntime = useMemo(() => createAgentRuntime(agentId), [agentId]);
  const pendingMentionsRef = useRef([]);

  const adapter = useMemo(() => ({
    async *run({ messages, abortSignal }) {
      const attachments = [
        ...collectAttachments(messages),
        ...pendingMentionsRef.current,
      ];
      pendingMentionsRef.current = [];
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

        {mentions
          ? <ComposerWithMentions mentions={mentions} pendingMentionsRef={pendingMentionsRef} />
          : <ComposerPlain />}
      </AssistantRuntimeProvider>
    </div>
  );
}

// ── Plain composer (no mention popover) ──────────────────────────────────────

function ComposerPlain() {
  return (
    <ComposerPrimitive.Root className="coach-chat__composer">
      <ComposerPrimitive.Input
        className="coach-chat__input"
        placeholder="Ask…"
      />
      <ComposerPrimitive.Send className="coach-chat__send" />
    </ComposerPrimitive.Root>
  );
}

// ── Composer with @-mention trigger popover ───────────────────────────────────

function ComposerWithMentions({ mentions, pendingMentionsRef }) {
  const { fetchUrl, categories, buildAttachment } = mentions;
  const [mentionCategories, setMentionCategories] = useState([]);

  useEffect(() => {
    if (!fetchUrl) return;
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(fetchUrl);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const suggestions = data.suggestions || [];

        // Group flat suggestions by `group` field; preserve display order
        // declared in the categories prop.
        const byGroup = new Map();
        for (const s of suggestions) {
          const key = s.group || 'other';
          if (!byGroup.has(key)) byGroup.set(key, []);
          byGroup.get(key).push(s);
        }

        const cats = categories
          .filter(c => byGroup.has(c.key))
          .map(c => ({
            id: c.key,
            label: c.label,
            items: byGroup.get(c.key).map(s => ({
              id: `${c.key}:${s.slug}`,
              type: c.key,
              label: s.label,
              description: s.description,
              icon: c.icon,
              metadata: buildAttachment({ ...s, group: c.key }),
            })),
          }));

        if (!cancelled) setMentionCategories(cats);
      } catch {
        // Non-fatal — mention popover will be empty, chat still works.
      }
    }

    load();
    return () => { cancelled = true; };
  }, [fetchUrl, categories, buildAttachment]);

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
          className="coach-chat__input"
          placeholder="Ask… (type @ to mention)"
        />
        <ComposerPrimitive.Send className="coach-chat__send" />
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
