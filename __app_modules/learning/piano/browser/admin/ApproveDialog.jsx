import React, { useEffect, useState } from 'react';
import { Alert, Badge, Button, Group, List, Loader, Modal, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconArrowBackUp, IconCheck } from '@tabler/icons-react';
import { DaylightAPI } from "../../../../../frontend/src/lib/api.mjs";
import { barsLabel } from "./MeasureStrip.jsx";

export const ADMIN_PATH = 'api/v1/admin/sheet-music';
export const scoreQuery = (id) => `?id=${encodeURIComponent(id)}`;

export const KEEP_TEXT = 'Progress on unchanged bars is kept. Changed bars start fresh. Restoring the old bars restores the old progress.';

const errorCode = (err) => (typeof err?.body?.error === 'string' ? err.body.error : null);

function passageText(measures, p) {
  const bars = Number.isInteger(p?.start) && Number.isInteger(p?.end) ? barsLabel(measures, p.start, p.end) : String(p?.id ?? 'passage');
  return bars;
}

function medalLost(p) {
  if (p?.gold) return 'Gold lost';
  if (p?.silver) return 'Silver lost';
  return 'no medal yet';
}

function LearnerImpact({ row, measures }) {
  const kept = Array.isArray(row.kept) ? row.kept : [];
  const orphaned = Array.isArray(row.orphaned) ? row.orphaned : [];
  const losesPolish = row.wasAllGold && !row.allGoldAfter;
  return (
    <Stack gap={4} data-testid={`impact-${row.userId}`}>
      <Group gap="xs">
        <Text fw={600} size="sm">{row.userId}</Text>
        {row.lostGold ? <Badge color="yellow" variant="light">{`${row.lostGold} Gold lost`}</Badge> : null}
        {row.lostSilver ? <Badge color="gray" variant="light">{`${row.lostSilver} Silver lost`}</Badge> : null}
      </Group>
      {kept.length ? (
        <Text size="sm">{`Kept: ${kept.map((p) => passageText(measures, p)).join(', ')}`}</Text>
      ) : <Text size="sm" c="dimmed">No passage is kept as it was.</Text>}
      {orphaned.length ? (
        <>
          <Text size="sm">Start fresh:</Text>
          <List size="sm" spacing={0}>
            {orphaned.map((p) => (
              <List.Item key={`${p.id}-${p.start}-${p.end}`}>{`${passageText(measures, p)} (${medalLost(p)})`}</List.Item>
            ))}
          </List>
        </>
      ) : null}
      {losesPolish ? (
        <Text size="sm" c="orange.8" fw={500}>{`${row.userId} loses Polish eligibility until re-earned.`}</Text>
      ) : null}
    </Stack>
  );
}

/**
 * Shows what approving the stored draft (mode `approve`) or going back to the
 * kiosk's generated segments (mode `revert`) does to each learner's progress, then
 * does it. Approve sends back the draftRevision the impact was computed against;
 * when the draft moved since (another tab), the server answers 409 and the page
 * reloads through `onDraftChanged`.
 */
export default function ApproveDialog({
  opened, mode = 'approve', scoreId, expectedDraftRevision, measures = [], measureCount, generated = [],
  onClose, onDone, onDraftChanged, logger,
}) {
  const [loading, setLoading] = useState(false);
  const [impact, setImpact] = useState(null);
  const [revision, setRevision] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!opened) { setImpact(null); setRevision(null); setError(null); setBusy(false); return undefined; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const q = scoreQuery(scoreId);
        const res = mode === 'approve'
          ? await DaylightAPI(`${ADMIN_PATH}/learn/draft-impact${q}`)
          : await DaylightAPI(`${ADMIN_PATH}/impact${q}`, { segments: generated.map(({ id, start, end }) => ({ id, start, end })) }, 'POST');
        if (cancelled) return;
        if (mode === 'approve' && expectedDraftRevision !== undefined && res?.draftRevision !== expectedDraftRevision) {
          onDraftChanged?.();
          return;
        }
        setImpact(Array.isArray(res?.impact) ? res.impact : []);
        setRevision(res?.draftRevision ?? null);
      } catch (err) {
        if (cancelled) return;
        const code = errorCode(err);
        logger?.warn('admin.sheetmusic.impact-failed', { id: scoreId, mode, code, status: err?.status ?? null });
        if (mode === 'approve' && code === 'no-draft') { onDraftChanged?.(); return; }
        setError('Could not work out what this changes for learners. Close and try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // generated is read once per opening; a new list would mean a new dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, mode, scoreId, expectedDraftRevision]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const q = scoreQuery(scoreId);
    try {
      const body = mode === 'approve'
        ? { action: 'approve', measureCount, expectedDraftRevision: revision }
        : { action: 'revert' };
      const result = await DaylightAPI(`${ADMIN_PATH}/learn${q}`, body, 'PUT');
      onDone?.(mode, result);
    } catch (err) {
      const code = errorCode(err);
      logger?.warn('admin.sheetmusic.save-failed', { id: scoreId, action: mode, code, status: err?.status ?? null });
      if (code === 'draft-changed' || code === 'no-draft') { onDraftChanged?.(); return; }
      setError(code === 'invalid-segments'
        ? 'The saved draft does not fit this score. Fix the segments, save, and approve again.'
        : `That did not save${code ? ` (${code})` : ''}. Try again.`);
    } finally {
      setBusy(false);
    }
  };

  const rows = impact || [];
  const title = mode === 'approve' ? 'Approve these segments' : 'Revert to generated segments';
  return (
    <Modal opened={opened} onClose={() => { if (!busy) onClose?.(); }} title={title} centered size="lg">
      <Stack gap="sm">
        <Text size="sm">
          {mode === 'approve'
            ? 'The kiosk will play these segments from the next time the score opens.'
            : 'The kiosk will go back to cutting this score itself. The draft is kept.'}
        </Text>
        <Text size="sm" c="dimmed">{KEEP_TEXT}</Text>
        {loading ? <Group gap="xs"><Loader size="xs" /><Text size="sm">Checking learner progress</Text></Group> : null}
        {!loading && impact && rows.length === 0 ? <Text size="sm">No learner has progress on this score.</Text> : null}
        {rows.map((row) => <LearnerImpact key={row.userId} row={row} measures={measures} />)}
        {error ? <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>{error}</Alert> : null}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            color={mode === 'approve' ? 'green' : 'orange'}
            leftSection={mode === 'approve' ? <IconCheck size={16} /> : <IconArrowBackUp size={16} />}
            onClick={confirm}
            loading={busy}
            disabled={loading || !impact || (mode === 'approve' && !revision)}
          >
            {mode === 'approve' ? 'Approve' : 'Revert'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
