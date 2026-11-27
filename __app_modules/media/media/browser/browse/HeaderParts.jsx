// Small pieces the info view and the Browse header share (2026-11-27): the
// parent chip (author, artist or show — one tap to its page) and a summary
// clamped to a few lines with More / Less.
import React, { useLayoutEffect, useRef, useState } from 'react';
import { Avatar, Button, Group, Text, UnstyledButton } from '@mantine/core';
import mediaLog from "../logging/mediaLog.js";

/**
 * A linked chip naming the parent: its image, its role ("Author", "Show") and
 * its name. A link in the plain sense: Enter/Space or a click opens it.
 */
export function ParentChip({ parent, onOpen, testId = 'parent-chip', onPrefetch = null }) {
  if (!parent) return null;
  return (
    <UnstyledButton
      className="media-parent-chip"
      data-testid={testId}
      aria-label={`${parent.role}: ${parent.title}`}
      onClick={onOpen}
      onPointerEnter={onPrefetch ?? undefined}
      onFocus={onPrefetch ?? undefined}
    >
      <Group gap="xs" wrap="nowrap">
        <Avatar src={parent.thumbnail} alt="" size={32} radius="xl">{parent.title.charAt(0)}</Avatar>
        <span className="media-parent-chip__text">
          <Text component="span" size="xs" c="dimmed" className="media-parent-chip__role">{parent.role}</Text>
          <Text component="span" size="sm" fw={600} className="media-parent-chip__name">{parent.title}</Text>
        </span>
      </Group>
    </UnstyledButton>
  );
}

/**
 * The summary, clamped to `lines`; More shows the rest in place and Less
 * folds it again. More appears only when the text actually overflows.
 */
export function ClampedSummary({ text, lines = 3, testId = 'summary', contentId = null }) {
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    // jsdom has no layout: a long text is treated as overflowing there.
    const measured = el.scrollHeight > 0 || el.clientHeight > 0;
    setOverflows(measured ? el.scrollHeight > el.clientHeight + 1 : String(text).length > 240);
  }, [text, open, lines]);
  if (!text) return null;
  return (
    <div className="media-summary" data-testid={testId}>
      <Text ref={ref} c="dimmed" lineClamp={open ? undefined : lines} data-open={open || undefined}>{text}</Text>
      {(overflows || open) && (
        <Button variant="subtle" size="compact-sm" data-testid={`${testId}-more`} aria-expanded={open}
          onClick={() => {
            const next = !open;
            setOpen(next);
            if (next) mediaLog.browseSummaryExpanded({ contentId, surface: testId });
          }}>
          {open ? 'Show less' : 'Show more'}
        </Button>
      )}
    </div>
  );
}
