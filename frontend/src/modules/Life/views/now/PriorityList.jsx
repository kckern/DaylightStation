import { useState } from 'react';
import { Stack, Paper, Group, Text, Badge, ThemeIcon, ActionIcon } from '@mantine/core';
import { IconX } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { priorityTypeMeta } from '../../theme/semantics.js';

const DISMISS_KEY = 'life.priorities.dismissed';
const keyOf = (item) => `${item.type}:${item.title}`;

function loadDismissed() {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')); }
  catch { return new Set(); }
}

function routeFor(item) {
  if (item.type === 'ceremony_due' && item.ceremonyType) return `/life/ceremony/${item.ceremonyType}`;
  if (item.type === 'plan_gap') {
    return { purpose: '/life/plan', values: '/life/plan/values', goals: '/life/plan/goals' }[item.gap] || '/life/coach';
  }
  if (item.related_value) return '/life/plan/values';
  return null;
}

export function PriorityList({ priorities = [] }) {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(loadDismissed);

  const dismiss = (item) => {
    const next = new Set(dismissed); next.add(keyOf(item));
    setDismissed(next);
    localStorage.setItem(DISMISS_KEY, JSON.stringify([...next]));
  };

  const visible = priorities.filter((p) => !dismissed.has(keyOf(p))).slice(0, 5);
  if (visible.length === 0) {
    return <Text size="sm" c="dimmed">You're all caught up — nothing needs your attention right now.</Text>;
  }

  return (
    <Stack gap="sm">
      {visible.map((item, i) => {
        const meta = priorityTypeMeta[item.type] || priorityTypeMeta.goal_deadline;
        const Icon = meta.icon;
        const route = routeFor(item);
        return (
          <Paper key={keyOf(item) + i} p="sm" withBorder
            className={route ? 'life-clickable' : undefined}
            onClick={route ? () => navigate(route) : undefined}>
            <Group wrap="nowrap">
              <ThemeIcon color={meta.color} variant="light" size="lg"><Icon size={18} /></ThemeIcon>
              <Stack gap={2} style={{ flex: 1 }}>
                <Text size="sm" fw={500}>{item.title}</Text>
                <Text size="xs" c="dimmed">{item.reason}</Text>
              </Stack>
              <Badge color={meta.color} variant="light" size="sm">{meta.label}</Badge>
              <ActionIcon variant="subtle" color="gray" aria-label={`Dismiss ${item.title}`}
                onClick={(e) => { e.stopPropagation(); dismiss(item); }}>
                <IconX size={14} />
              </ActionIcon>
            </Group>
          </Paper>
        );
      })}
    </Stack>
  );
}
