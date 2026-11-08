import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Anchor, Badge, Group, Stack, Text } from '@mantine/core';
import { useApiResource } from '../../../../../../frontend/src/lib/hooks/useApiResource.js';
import { LoadingState, ErrorState, SectionCard, createAppLogger } from '../../../../../../frontend/src/lib/ui/index.js';
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
  const running = data?.job && (data.job.status === 'queued' || data.job.status === 'running');
  const waiting = !!data && (running || (data.audit && !data.audit.fresh));

  useEffect(() => { logger.info('review.mounted', { ratingKey }); }, [ratingKey]);
  useEffect(() => {
    if (!waiting) return undefined;
    const id = setInterval(() => reload(), POLL_MS);
    return () => clearInterval(id);
  }, [waiting, reload]);

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
            {row ? <RowEditor key={row.id} ratingKey={ratingKey} row={row} onChanged={reload} busyText={busyText} />
              : <Text size="sm" c="dimmed">Pick a part in the list to change how it is handled.</Text>}
            <SignOffPanel ratingKey={ratingKey} signOff={data.signOff} onChanged={reload} busyText={busyText} />
          </Stack>
          <ReviewList rows={data.rows} reviewed={data.reviewed} total={data.total} audit={data.audit}
            selectedId={row?.id ?? null} onSelect={setSelected} busy={Boolean(busyText)} />
        </div>
      </Stack>
    </SectionCard>
  );
}

export default ReviewPage;
