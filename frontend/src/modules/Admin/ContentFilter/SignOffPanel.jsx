import { Button, Group, List, Stack, Text } from '@mantine/core';
import { ApprovalFeedback, useApprovalRegion } from './FilmApprovalControls.jsx';

/**
 * What still stands between the film and family approval, and Withdraw once approved. Approving
 * itself is the film status card's button (FilmStatusCard.jsx), shown when nothing is missing.
 * No pipeline stage is offered here (2026-11-12: the "Stage again" dropdown is gone).
 */
export function SignOffPanel({ signOff, approval, busyText = null }) {
  const { regionProps, feedback, start, retry } = useApprovalRegion(approval, 'withdraw');
  return (
    <Stack component="section" {...regionProps} aria-label="Family approval" gap="xs" className="cf-signoff">
      {signOff?.parent ? (
        <Group gap="xs" wrap="wrap">
          <Text size="sm">Approved for family by {signOff.parent.by}.</Text>
          <Button size="compact-xs" variant="subtle" color="red" disabled={approval.blocked || Boolean(busyText)} onClick={start}>Withdraw approval</Button>
        </Group>
      ) : (
        signOff?.missing?.length ? <List size="sm" spacing={2}>{signOff.missing.map((m) => <List.Item key={m}>{m}</List.Item>)}</List> : null
      )}
      <ApprovalFeedback feedback={feedback} onRetry={retry} />
    </Stack>
  );
}

export default SignOffPanel;
