import { useEffect, useMemo } from 'react';
import { Group, Text, Button } from '@mantine/core';
import { Link } from 'react-router-dom';
import { IconCheck, IconCircleFilled, IconPencil, IconAlertCircle } from '@tabler/icons-react';
import { SectionCard } from "../../components/index.js";
import getLogger from "../../../../../../frontend/src/lib/logging/Logger.js";

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Compact head-of-dashboard card. Counts as the content, one action. Renders nothing
 * for a user who is not enrolled. `summary` is the /api/v1/triage/summary body.
 */
export function TriageSummaryCard({ summary, error = null, onRetry = null }) {
  const logger = useMemo(() => getLogger().child({ component: 'triage-summary-card' }), []);
  const enrolled = summary?.enrolled === true;
  useEffect(() => {
    if (enrolled) logger.debug('life.triage.card.shown', { mode: summary.mode, mailbox: summary.mailbox });
  }, [enrolled, summary?.mode, summary?.mailbox, logger]);

  // A failed fetch with nothing to show: one quiet line in the card's place.
  if (!summary && error) {
    return (
      <Group gap="xs" role="status">
        <IconAlertCircle size={16} color="var(--mantine-color-dimmed)" />
        <Text size="sm" c="dimmed">Triage unavailable</Text>
        {onRetry && <Button variant="subtle" size="compact-xs" onClick={onRetry}>retry</Button>}
      </Group>
    );
  }
  if (!enrolled) return null;

  const open = summary.open ?? {};
  const pre = summary.preDone ?? {};
  const drafted = summary.draftsReady ?? 0;
  // Dry-run cards are counted in wouldHave, not as calls to make (the backend excludes them).
  const needCall = (open.unsure ?? 0) + (open.todo ?? 0) + Math.max(0, (open.reply ?? 0) - drafted);
  const dry = summary.mode === 'dryRun';
  const reconnect = summary.mailbox === 'reconnect_needed';
  const total = needCall + drafted;
  const icon = (Icon, color) => <Icon size={14} color={color} aria-hidden />;

  const parts = [];
  if (dry) {
    const w = summary.wouldHave ?? {};
    parts.push({ key: 'dry', icon: icon(IconCheck, 'var(--mantine-color-dimmed)'), text: `Dry run: would have archived ${w.archived ?? 0} · closed ${w.closed ?? 0}` });
  } else {
    parts.push({ key: 'archived', icon: icon(IconCheck, 'var(--mantine-color-teal-6)'), text: `${plural(pre.archived ?? 0, 'email', 'emails')} archived` });
    parts.push({ key: 'closed', icon: icon(IconCheck, 'var(--mantine-color-teal-6)'), text: plural(pre.closed ?? 0, 'stale todo', 'stale todos') });
  }
  parts.push({ key: 'call', icon: icon(IconCircleFilled, 'var(--mantine-color-orange-6)'), text: `${needCall} need your call` });
  parts.push({ key: 'drafted', icon: icon(IconPencil, 'var(--mantine-color-dimmed)'), text: `${plural(drafted, 'reply', 'replies')} drafted` });

  return (
    <SectionCard title="Triage">
      <Group justify="space-between" align="center" wrap="wrap" gap="sm">
        <Group gap="md" wrap="wrap">
          {parts.map((p) => (
            <Group key={p.key} gap={4} wrap="nowrap">{p.icon}<Text size="sm">{p.text}</Text></Group>
          ))}
        </Group>
        <Button component={Link} to="/life/now/triage" className="ds-touch-target" size="xs"
          onClick={() => logger.info('life.triage.card.start', { open: total })}>Start triage →</Button>
      </Group>
      {reconnect && <Text size="sm" c="red" mt="xs">Reconnect {summary.mailboxName || 'your mailbox'}: mail can&apos;t be archived until it is reconnected.</Text>}
    </SectionCard>
  );
}

export default TriageSummaryCard;
