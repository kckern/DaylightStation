import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Anchor, Badge, Button, Group, Stack, Text } from '@mantine/core';
import { DaylightAPI } from '../../../lib/api.mjs';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { LoadingState, ErrorState, SectionCard, createAppLogger } from '../../../lib/ui/index.js';
import { ReviewList } from './ReviewList.jsx';
import { ReviewPlayer } from './ReviewPlayer.jsx';
import { RowEditor } from './RowEditor.jsx';
import { SignOffPanel } from './SignOffPanel.jsx';
import { runText } from './FilterLibrary.jsx';
import './ContentFilterAdmin.scss';

/**
 * Admin -> Content filter -> one film: check every part the filter acts on ("Check it" in
 * ops:docs/superpowers/specs/2026-11-07-content-filter-admin-workshop-design.md).
 */
const logger = createAppLogger('admin').child('content-filter');
const API = 'api/v1/content-filter';
const POLL_MS = 3000;
const LEVEL = { none: 'Not certified', machine: 'Machine-certified', parent: 'Parent-certified' };

export function ReviewPage() {
  const { ratingKey } = useParams();
  const url = `${API}/${encodeURIComponent(ratingKey)}/review`;
  const { data, loading, error, reload } = useApiResource(url, { label: 'review', logger });
  const [selected, setSelected] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [notice, setNotice] = useState(null);
  const running = data?.job && (data.job.status === 'queued' || data.job.status === 'running');
  const waiting = !!data && (running || (data.audit && !data.audit.fresh));

  useEffect(() => { logger.info('review.mounted', { ratingKey }); }, [ratingKey]);
  useEffect(() => {
    if (!waiting) return undefined;
    const id = setInterval(() => reload(), POLL_MS);
    return () => clearInterval(id);
  }, [waiting, reload]);

  // Rows in a queued/running send-back carry its step ("Sent back: refine").
  const sentBack = useMemo(() => {
    const job = data?.job;
    if (!job || job.kind !== 'send-back' || !(job.status === 'queued' || job.status === 'running')) return {};
    const cues = new Set(job.cues || []);
    const out = {};
    for (const r of data.rows || []) if ((r.members || []).some((id) => cues.has(id))) out[r.id] = job.status === 'queued' ? 'waiting' : (job.step || 'starting');
    return out;
  }, [data]);
  const pick = (id, on) => setPicked((prev) => { const next = new Set(prev); if (on) next.add(id); else next.delete(id); return next; });
  const sendBackPicked = async () => {
    const cues = [...new Set((data?.rows || []).filter((r) => picked.has(r.id)).flatMap((r) => r.members || []))];
    setNotice(null);
    try {
      await DaylightAPI(`${API}/${encodeURIComponent(ratingKey)}/jobs`, { kind: 'send-back', cues }, 'POST');
      logger.info('review.send-back', { ratingKey, rows: picked.size, cues: cues.length });
      setPicked(new Set());
      setNotice(`Sent ${cues.length} back to the pipeline.`);
      reload();
    } catch (err) {
      logger.warn('review.send-back_failed', { ratingKey, error: err.message });
      setNotice(err.message || 'That did not work.');
    }
  };

  if (loading && !data) return <LoadingState label="review" rows={6} />;
  if (error) return <ErrorState error={error} onRetry={reload} label="Review" />;
  const row = data.rows.find((r) => r.id === selected?.id) || null;
  const busyText = running ? `Running: ${data.job.step || 'starting'}` : null;
  return (
    <SectionCard title={data.title || `Film ${ratingKey}`}
      actions={<Anchor component={Link} to="/admin/content/filter" size="sm">All films</Anchor>}>
      <Stack gap="sm">
        <Group gap="xs" wrap="wrap">
          <Badge variant="light" color={data.certification.level === 'none' ? 'gray' : 'green'}>{LEVEL[data.certification.level] || data.certification.level}</Badge>
          {data.job ? <Text size="sm" c={data.job.status === 'failed' ? 'red' : 'dimmed'}>{runText(data.job)}</Text> : null}
          {!data.audit ? <Text size="sm" c="dimmed">No audit yet. Run the film from the library to see its parts.</Text> : null}
        </Group>
        <div className="cf-review">
          <Stack gap="sm" className="cf-review__side">
            <ReviewPlayer ratingKey={ratingKey} />
            {row ? <RowEditor key={row.id} ratingKey={ratingKey} row={row} onChanged={reload} busyText={busyText}
              auditFresh={!!data.audit?.fresh} wordRulings={data.wordRulings || {}} />
              : <Text size="sm" c="dimmed">Pick a part in the list to change how it is handled.</Text>}
            <SignOffPanel ratingKey={ratingKey} signOff={data.signOff} onChanged={reload} busyText={busyText} />
          </Stack>
          <Stack gap="xs">
            {picked.size ? (
              <Group gap="xs">
                <Button size="compact-xs" disabled={Boolean(busyText)} onClick={sendBackPicked}>Send back {picked.size} selected</Button>
                <Button size="compact-xs" variant="subtle" onClick={() => setPicked(new Set())}>Clear selection</Button>
              </Group>
            ) : null}
            {notice ? <Text size="sm" role="status">{notice}</Text> : null}
            <ReviewList rows={data.rows} reviewed={data.reviewed} total={data.total} audit={data.audit}
              selectedId={row?.id ?? null} onSelect={setSelected} picked={picked} onPick={pick} sentBack={sentBack} />
          </Stack>
        </div>
      </Stack>
    </SectionCard>
  );
}

export default ReviewPage;
