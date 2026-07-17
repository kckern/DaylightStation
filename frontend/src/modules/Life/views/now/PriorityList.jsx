import { useState } from 'react';
import { Stack, Paper, Group, Text, Badge, ThemeIcon, ActionIcon } from '@mantine/core';
import { IconX } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { priorityTypeMeta } from '../../theme/semantics.js';
import { useLifeUsername } from '../../hooks/useLifeUser.js';

const DISMISS_KEY = 'life.priorities.dismissed';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Load the dismissed-card set, dropping any entries whose date segment isn't
 * today (dismissals are "for today, for this user" — they auto-expire) and
 * persisting the pruned set so localStorage doesn't grow unbounded.
 */
function loadDismissed(today) {
  try {
    const raw = JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]');
    const pruned = raw.filter((k) => k.split(':')[1] === today);
    if (pruned.length !== raw.length) {
      try { localStorage.setItem(DISMISS_KEY, JSON.stringify(pruned)); }
      catch { /* ignore quota/private-mode errors */ }
    }
    return new Set(pruned);
  } catch { return new Set(); }
}

function routeFor(item) {
  if (item.type === 'ceremony_due' && item.ceremonyType) return `/life/ceremony/${item.ceremonyType}`;
  if (item.type === 'plan_gap') {
    return { purpose: '/life/plan', values: '/life/plan/values', goals: '/life/plan/goals' }[item.gap] || '/life/coach';
  }
  // related_value is only a real value id on drift_alert items; on goal_deadline
  // it's the goal's quality id, so routing it to /life/plan/values would be wrong.
  // The backend doesn't emit a goal id on goal_deadline items, so there's no
  // correct destination for those — leave them non-navigable.
  if (item.type === 'drift_alert' && item.related_value) return '/life/plan/values';
  return null;
}

export function PriorityList({ priorities = [] }) {
  const navigate = useNavigate();
  const username = useLifeUsername();
  const today = todayStr();
  const keyOf = (item) => `${username || 'anon'}:${today}:${item.type}:${item.title}`;
  const [dismissed, setDismissed] = useState(() => loadDismissed(today));

  const dismiss = (item) => {
    const next = new Set(dismissed); next.add(keyOf(item));
    setDismissed(next);
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...next])); }
    catch { /* ignore quota/private-mode errors */ }
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
