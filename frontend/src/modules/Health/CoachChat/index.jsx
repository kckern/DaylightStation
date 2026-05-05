// frontend/src/modules/Health/CoachChat/index.jsx
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  unstable_useMentionAdapter,
} from '@assistant-ui/react';
import { useMemo, useEffect, useRef, useState } from 'react';
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
  // Mention insertions captured here; runtime adapter reads them on run().
  const pendingMentionsRef = useRef([]);

  const adapter = useMemo(() => ({
    async run({ messages, abortSignal }) {
      const attachments = [
        ...collectAttachments(messages),
        ...pendingMentionsRef.current,
      ];
      pendingMentionsRef.current = [];
      return healthCoachChatModel.run({
        messages,
        userId,
        attachments,
        abortSignal,
      });
    },
  }), [userId]);

  const runtime = useLocalRuntime(adapter);

  // ── Mention data ──────────────────────────────────────────────────────────
  // Pre-fetch all suggestions once on mount, group into Unstable_MentionCategory[].
  const [mentionCategories, setMentionCategories] = useState([]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(
          `/api/v1/health/mentions/all?user=${encodeURIComponent(userId)}`
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const suggestions = data.suggestions || [];

        // Group flat suggestions by `group` field into MentionCategory shape.
        // Preserve the display order declared in MENTION_CATEGORIES.
        const byGroup = new Map();
        for (const s of suggestions) {
          const key = s.group || 'other';
          if (!byGroup.has(key)) byGroup.set(key, []);
          byGroup.get(key).push(s);
        }

        const cats = MENTION_CATEGORIES
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
  }, [userId]);

  // ── Mention adapter ───────────────────────────────────────────────────────
  const mention = unstable_useMentionAdapter({
    categories: mentionCategories,
    includeModelContextTools: false,
    onInserted: (item) => {
      // item.metadata holds the buildAttachment() payload; accumulate it.
      if (item?.metadata) {
        pendingMentionsRef.current = [...pendingMentionsRef.current, item.metadata];
      }
    },
  });

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

        {/* Composer with @-mention trigger popover */}
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
              {(categories) =>
                categories.map(cat => (
                  <ComposerPrimitive.Unstable_TriggerPopoverCategoryItem
                    key={cat.id}
                    categoryId={cat.id}
                    className="coach-chat__mention-category"
                  >
                    <Chip label={cat.label} chipKey={cat.id} />
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
              placeholder="Ask your health coach… (type @ to mention a period or metric)"
            />
            <ComposerPrimitive.Send className="coach-chat__send" />
          </ComposerPrimitive.Root>
        </ComposerPrimitive.Unstable_TriggerPopoverRoot>
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
