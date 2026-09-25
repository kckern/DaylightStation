import { useMemo, useRef, useState } from 'react';
import { Badge, Button, Group, Stack, Text } from '@mantine/core';
import { Sheet, LoadingState, ErrorState } from '../../../lib/ui';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { DaylightAPI } from '../../../lib/api.mjs';
import getLogger from '../../../lib/logging/Logger.js';
import { refreshHealthResources } from '../healthResources.js';
import { cleanupPath, RepairPreview } from '../cleanup/CleanupQuestions.jsx';
import { RepairChanges } from '../cleanup/RepairChanges.jsx';
import { SUPPRESSED_REASONS, formatUsd, formatWhen, permissionLabel, triggerLabel } from './auditorFormat.js';

const json = value => JSON.stringify(value, null, 2);
const tokens = n => (Number.isFinite(n) ? n.toLocaleString() : '—');

function Section({ title, children }) {
  return <section className="health-auditor-detail__section">
    <Text fw={600}>{title}</Text>
    {children}
  </section>;
}

function ToolCall({ call }) {
  const meta = [call.ok === false ? 'failed' : call.ok ? 'ok' : null, Number.isFinite(call.latencyMs) ? `${call.latencyMs} ms` : null].filter(Boolean).join(' · ');
  return <Stack gap={2}>
    <Text size="sm"><code>{call.name}</code>{meta ? <Text span size="xs" className={call.ok === false ? 'health-auditor-detail__danger' : 'health-auditor-detail__muted'}> {meta}</Text> : null}</Text>
    <details><summary>Arguments</summary><pre className="health-cleanup-evidence">{json(call.args ?? null)}</pre></details>
    {'result' in call ? <details><summary>Result</summary><pre className="health-cleanup-evidence">{typeof call.result === 'string' ? call.result : json(call.result)}</pre></details> : null}
  </Stack>;
}

function LookedAt({ row }) {
  const { transcript } = row;
  const digest = row.toolCalls || [];
  let note = null;
  if (row.transcriptError) note = 'Transcript unavailable';
  else if (row.transcriptExpired) note = 'Transcript expired';
  return <Stack gap="xs">
    {transcript && Number.isFinite(transcript.inputRows) ? <Text size="sm">{transcript.inputRows} food entries in scope</Text> : null}
    {note ? <Text size="sm" className="health-auditor-detail__muted">{note}</Text> : null}
    {transcript ? (transcript.toolCalls || []).map((call, i) => <ToolCall key={i} call={call} />)
      : digest.length ? <>
        <Text size="xs" className="health-auditor-detail__muted">Tool calls recorded in the journal:</Text>
        {digest.map((call, i) => <ToolCall key={i} call={call} />)}
      </> : !note ? <Text size="sm" className="health-auditor-detail__muted">No transcript for this run.</Text> : null}
  </Stack>;
}

function AppliedOutcome({ outcome, undo }) {
  const id = outcome.operationId;
  return <Stack gap="xs">
    {outcome.before || outcome.after ? <RepairChanges record={outcome} />
      : outcome.proposal ? <RepairPreview repair={outcome.proposal} />
      : <Text size="sm">Changed {outcome.affectedIds?.length || 0} food {outcome.affectedIds?.length === 1 ? 'entry' : 'entries'}. The before and after are in Repair history below.</Text>}
    {id ? <Group gap="xs">
      {undo.done[id] ? <Text size="sm" role="status">Undone</Text>
        : <Button size="xs" variant="light" loading={undo.busy === id} disabled={!!undo.busy} onClick={() => undo.run(id)}>Undo this change</Button>}
      {undo.errors[id] ? <Text size="sm" className="health-auditor-detail__danger" role="alert">{undo.errors[id]}</Text> : null}
    </Group> : null}
  </Stack>;
}

function useUndo({ runId, logger, onUndone }) {
  const [busy, setBusy] = useState(null);
  const [done, setDone] = useState({});
  const [errors, setErrors] = useState({});
  const operations = useRef({});
  const run = async repairId => {
    if (busy) return;
    setBusy(repairId); setErrors(current => ({ ...current, [repairId]: null }));
    // One operation id per repair, so a retry after a dropped response is idempotent.
    operations.current[repairId] ||= crypto.randomUUID();
    try {
      await DaylightAPI(`${cleanupPath}/undo/${repairId}`, { operationId: operations.current[repairId] }, 'POST');
      setDone(current => ({ ...current, [repairId]: true }));
      logger.info('health-auditor.undo.success', { runId, repairId });
      refreshHealthResources(); onUndone();
    } catch (error) {
      setErrors(current => ({ ...current, [repairId]: error.message }));
      logger.warn('health-auditor.undo.failed', { runId, repairId, error: error.message });
    } finally { setBusy(null); }
  };
  return { run, busy, done, errors };
}

function Detail({ row, logger, onUndone }) {
  const undo = useUndo({ runId: row.runId, logger, onUndone });
  const outcomes = row.outcomes || [];
  const applied = outcomes.filter(o => o.status === 'applied');
  const proposed = outcomes.filter(o => o.status === 'proposed');
  const unchanged = outcomes.filter(o => o.status === 'unchanged').length;
  const refused = outcomes.filter(o => ['rejected', 'skipped', 'blocked'].includes(o.status));
  const questions = row.questions || [];
  const suppressed = row.suppressedQuestions || [];
  const usage = row.usage;
  return <Stack gap="md" className="health-auditor-detail">
    <Section title="Why it ran">
      <Group gap={4}>{(row.trigger || []).map(kind => <Badge key={kind} size="sm" variant="light">{triggerLabel(kind)}</Badge>)}</Group>
      <Text size="sm">
        {[row.manual ? 'Started by hand' : 'Started automatically', row.overCap ? 'ran over the daily cap' : null,
          row.dryRun ? 'preview only (nothing changed)' : null].filter(Boolean).join(' · ')}
      </Text>
      <Text size="sm">Model: {row.model || 'unknown'}{row.status === 'failed' ? <Text span className="health-auditor-detail__danger"> · Failed{row.error ? `: ${row.error}` : ''}</Text> : null}</Text>
    </Section>

    <Section title="What it looked at"><LookedAt row={row} /></Section>

    <Section title="What it noticed">
      <Text size="sm">{row.summary || 'No summary.'}</Text>
      {questions.map((q, i) => <Stack gap={2} key={i}>
        <Text size="sm">Asked: {q.question}</Text>
        {q.choices?.length ? <Text size="xs" className="health-auditor-detail__muted">Choices: {q.choices.join(' / ')}</Text> : null}
      </Stack>)}
      {suppressed.map((q, i) => <Stack gap={2} key={`s${i}`}>
        <Text size="sm">Not asked: {q.question}</Text>
        <Text size="xs" className="health-auditor-detail__muted">{SUPPRESSED_REASONS[q.reason] || q.reason}</Text>
      </Stack>)}
    </Section>

    <Section title="What it changed">
      {applied.map((outcome, i) => <AppliedOutcome key={outcome.operationId || i} outcome={outcome} undo={undo} />)}
      {proposed.map((outcome, i) => <Stack gap={2} key={`p${i}`}>
        <Text size="xs" className="health-auditor-detail__muted">Would change (preview)</Text>
        <RepairPreview repair={outcome.proposal} />
      </Stack>)}
      {row.backfilled ? (row.proposals || []).map((proposal, i) => <Stack gap={2} key={`b${i}`}>
        <Text size="xs" className="health-auditor-detail__muted">Proposed (from transcript){proposal.reason ? `: ${proposal.reason}` : ''}</Text>
        <RepairPreview repair={proposal} />
      </Stack>) : null}
      {unchanged ? <Text size="sm" className="health-auditor-detail__muted">{unchanged} {unchanged === 1 ? 'repair' : 'repairs'} had nothing left to change.</Text> : null}
      {!applied.length && !proposed.length && !(row.backfilled && row.proposals?.length) ? <Text size="sm">Nothing changed.</Text> : null}
    </Section>

    {refused.length ? <Section title="Rejected or blocked">
      {refused.map((outcome, i) => <Stack gap={2} key={i}>
        <Text size="sm">{outcome.status === 'blocked'
          ? `Blocked: not allowed to change ${(outcome.kinds || []).map(permissionLabel).join(', ')}`
          : `${outcome.status === 'skipped' ? 'Skipped' : 'Rejected'}: ${outcome.reason || 'no reason given'}`}</Text>
        {outcome.proposal ? <RepairPreview repair={outcome.proposal} /> : null}
      </Stack>)}
    </Section> : null}

    <Section title="Cost">
      <Text size="sm">Input {tokens(usage?.input)} · cached {tokens(usage?.cached)} · output {tokens(usage?.output)} tokens</Text>
      <Text size="sm">{formatUsd(row.costUsd)}</Text>
    </Section>
  </Stack>;
}

/** One auditor run in full: why, what it read, what it noticed and changed, and cost. */
export function RunDetail({ run, onClose, onUndone = () => {} }) {
  const logger = useMemo(() => getLogger().child({ component: 'health-auditor' }), []);
  const path = `${cleanupPath}/journal/${encodeURIComponent(run.runId)}${run.at ? `?at=${encodeURIComponent(run.at)}` : ''}`;
  const entry = useApiResource(path, { swr: true });
  return <Sheet open title={`Run at ${formatWhen(run.at)}`} onClose={onClose}>
    {entry.data ? <Detail row={entry.data} logger={logger} onUndone={onUndone} />
      : entry.error ? <ErrorState error={entry.error} onRetry={entry.reload} label="Run detail" />
      : <LoadingState label="Run detail" />}
  </Sheet>;
}

export default RunDetail;
