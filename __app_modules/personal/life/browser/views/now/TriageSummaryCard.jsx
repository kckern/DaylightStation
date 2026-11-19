import { useEffect, useMemo } from 'react';
import { Group, Text, Button } from '@mantine/core';
import { useNavigate } from 'react-router-dom';
import { SectionCard } from "../../components/index.js";
import getLogger from "../../../../../../frontend/src/lib/logging/Logger.js";

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Compact head-of-dashboard card. Counts as the content, one action. Renders nothing
 * for a user who is not enrolled. `summary` is the /api/v1/triage/summary body.
 */
export function TriageSummaryCard({ summary }) {
  const navigate = useNavigate();
  const logger = useMemo(() => getLogger().child({ component: 'triage-summary-card' }), []);
  const enrolled = summary?.enrolled === true;
  useEffect(() => {
    if (enrolled) logger.debug('life.triage.card.shown', { mode: summary.mode, mailbox: summary.mailbox });
  }, [enrolled, summary?.mode, summary?.mailbox, logger]);
  if (!enrolled) return null;

  const open = summary.open ?? {};
  const pre = summary.preDone ?? {};
  const drafted = summary.draftsReady ?? 0;
  const needCall = (open.unsure ?? 0) + (open.todo ?? 0) + Math.max(0, (open.reply ?? 0) - drafted);
  const dry = summary.mode === 'dryRun';
  const reconnect = summary.mailbox === 'reconnect_needed';
  const total = needCall + drafted;

  const parts = [];
  if (dry) {
    parts.push({ key: 'dry', text: `Dry run: would have archived ${summary.wouldHave?.archived ?? 0}` });
  } else {
    parts.push({ key: 'archived', text: `✓ ${plural(pre.archived ?? 0, 'email', 'emails')} archived` });
    parts.push({ key: 'closed', text: `✓ ${plural(pre.closed ?? 0, 'stale todo', 'stale todos')}` });
  }
  parts.push({ key: 'call', text: `● ${needCall} need your call` });
  parts.push({ key: 'drafted', text: `✎ ${plural(drafted, 'reply', 'replies')} drafted` });

  const start = () => {
    logger.info('life.triage.card.start', { open: total });
    navigate('/life/now/triage');
  };

  return (
    <SectionCard title="Triage">
      <Group justify="space-between" align="center" wrap="wrap" gap="sm">
        <Group gap="md" wrap="wrap">
          {parts.map((p) => <Text key={p.key} size="sm">{p.text}</Text>)}
        </Group>
        <Button size="xs" onClick={start}>Start triage →</Button>
      </Group>
      {reconnect && <Text size="sm" c="red" mt="xs">Reconnect Gmail: mail can&apos;t be archived until it is reconnected.</Text>}
    </SectionCard>
  );
}

export default TriageSummaryCard;
