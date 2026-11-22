import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Anchor, Badge, Button, Group, Stack, Text } from '@mantine/core';
import { DaylightAPI } from '../../../lib/api.mjs';
import { useVisibleRefresh } from '../../../lib/hooks/useVisibleRefresh.js';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { previewStore } from '../../../../../__app_modules/media/media/browser/content-filter/adminWorkspace.mjs';
import { LoadingState, ErrorState, SectionCard, createAppLogger } from '../../../lib/ui/index.js';
import { ReviewList } from './ReviewList.jsx';
import { ReviewTimeline } from './ReviewTimeline.jsx';
import { ReviewKeyBar } from './ReviewKeyBar.jsx';
import { useReviewKeys } from './useReviewKeys.js';
import { useReviewStation } from './useReviewStation.js';
import { hasVerdict, plays } from './reviewScope.js';
import { ReviewPlayer } from './ReviewPlayer.jsx';
import { RowEditor } from './RowEditor.jsx';
import { SignOffPanel } from './SignOffPanel.jsx';
import { FilmStatusCard } from './FilmStatusCard.jsx';
import { useFilmApproval, useFilmReviewOwner } from './useFilmApproval.js';
import { runText } from './FilterLibrary.jsx';
import './ContentFilterAdmin.scss';

/**
 * Admin -> Content filter -> one film: every part in the film, one at a time ("Check it" in
 * ops:docs/superpowers/specs/2026-11-07-content-filter-admin-workshop-design.md; all parts, not
 * only the filtered ones, and progress meters: owner, 2026-11-21).
 */
const logger = createAppLogger('admin').child('content-filter');
const API = 'api/v1/content-filter';
const POLL_MS = 3000;
const LEVEL = { none: 'Not certified', machine: 'Machine-certified', parent: 'Parent-certified' };
// Why a film lists no parts yet (its status card says what to do about it).
const EMPTY = {
  refine: 'No parts to review until the film is refined.',
  checking: 'The list appears when the check finishes.',
  running: 'The list appears when the run finishes.',
  'check-failed': 'The check failed, so there is no list yet.',
  none: 'This film has no filters yet.',
};

export function ReviewPage() {
  const { ratingKey, rowId } = useParams();
  const owner = useFilmReviewOwner();
  const [session, setSession] = useState({ owner, visit: 0 });
  if (owner !== session.owner) setSession({ owner, visit: session.visit + 1 });
  return <FilmReview key={`${ratingKey}:${session.visit}`} ratingKey={ratingKey} rowId={rowId} owner={owner} />;
}

function FilmReview({ ratingKey, rowId, owner }) {
  const navigate = useNavigate();
  const url = `${API}/${encodeURIComponent(ratingKey)}/review`;
  // A new signed-in visit needs its own HTTP read even at the same film URL.
  const { data, loading, error, reload, refresh, poll } = useApiResource(url, { label: 'review', logger, dedupe: false });
  const [selected, setSelected] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [notice, setNotice] = useState(null);
  const [sending, setSending] = useState(false);
  const activeView = useRef(true);
  const approval = useFilmApproval({ ratingKey, owner, data, error, reload, activeView });
  const running = data?.job && (data.job.status === 'queued' || data.job.status === 'running');
  const waiting = !!data && (running || (data.audit && !data.audit.fresh) || data.status?.next === 'checking');

  // Selecting a row keeps the URL (the filter's permalink) in step; the page state is the source of truth.
  const opened = useRef(null);
  const select = (r) => {
    setSelected(r);
    if (r?.id) opened.current = r.id;
    if (r?.id && r.id !== rowId) navigate(`/admin/content/filter/${encodeURIComponent(ratingKey)}/${encodeURIComponent(r.id)}`, { replace: true });
  };
  useEffect(() => {
    activeView.current = true;
    return () => {
      activeView.current = false;
      opened.current = null;
      previewStore.clearPending();
    };
  }, []);
  // Opening a permalink: select the row and seek to it once (the store holds the jump until the player binds).
  useEffect(() => {
    if (!rowId || !data?.rows || opened.current === rowId) return;
    opened.current = rowId;
    const found = data.rows.find((r) => r.id === rowId);
    logger.info('content_filter.review.permalink.opened', { rk: ratingKey, rowId, found: !!found });
    if (!found) { setNotice("That filter isn't in this film any more"); return; }
    setSelected(found);
    previewStore.jumpToCue({ in: found.in });
  }, [rowId, data, ratingKey]);
  useEffect(() => { logger.info('review.mounted', { ratingKey }); }, [ratingKey]);
  // The keyboard station: the cursor is `selected`; scope, verdicts and stepping live in the hook.
  // Not matched to Plex: a key that still holds household work shows its review; runs are refused.
  const notMatched = data?.match === 'unmatched';
  const station = useReviewStation({ ratingKey, data, reload, refreshReview: refresh, selected, select, activeView, runBusy: running || notMatched });
  const { redoOpen } = useReviewKeys(station.handlers, { enabled: Boolean(data?.rows) });
  useVisibleRefresh({ active: Boolean(waiting), intervalMs: POLL_MS, reload, poll });

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
    if (sending || !cues.length) return;
    setSending(true);
    setNotice(null);
    try {
      await DaylightAPI(`${API}/${encodeURIComponent(ratingKey)}/jobs`, { kind: 'send-back', cues }, 'POST');
      logger.info('review.send-back', { ratingKey, rows: picked.size, cues: cues.length });
      if (!activeView.current) return;
      setPicked(current => new Set([...current].filter(id => !picked.has(id))));
      setNotice(`Sent ${cues.length} back to the pipeline.`);
      reload();
    } catch (err) {
      logger.warn('review.send-back_failed', { ratingKey, error: err.message });
      if (activeView.current) setNotice(err.message || 'That did not work.');
    } finally {
      if (activeView.current) setSending(false);
    }
  };

  if (loading && !data) return <LoadingState label="review" rows={6} />;
  if (error && (!data || !approval.blocked)) return <ErrorState error={error} onRetry={reload} label="Review" />;
  if (notMatched && !Array.isArray(data.rows)) return <UnmatchedFilm ratingKey={ratingKey} data={data} />;
  const row =data.rows.find((r) => r.id === selected?.id) || null;
  const busyText = running ? `Running: ${data.job.step || 'starting'}` : null;
  const runBlock = busyText || (notMatched ? 'Not matched to Plex' : null);
  return (
    <SectionCard title={data.title || `Film ${ratingKey}`}
      actions={<Anchor component={Link} to="/admin/content/filter" size="sm">All films</Anchor>}>
      <Stack gap="sm">
        <Group gap="xs" wrap="wrap">
          <Badge variant="light" color={data.certification.level === 'none' ? 'gray' : 'green'}>{LEVEL[data.certification.level] || data.certification.level}</Badge>
          {data.job && data.status?.next !== 'running' ? <Text size="sm" c={data.job.status === 'failed' ? 'red' : 'dimmed'}>{runText(data.job)}</Text> : null}
        </Group>
        <FilmStatusCard ratingKey={ratingKey} status={data.status} parts={data.parts || null} review={data.parts ? { reviewed: data.reviewed, total: data.total } : null} job={data.job} approvedBy={data.signOff?.parent?.by || null} auditError={data.auditError || null} worker={data.worker || null} approval={approval}
          onChanged={reload} onReview={() => { const first = station.scoped.find((r) => !r.verdict) || data.rows[0]; if (first) station.pick(first); }} />
        {notMatched ? (
          <Text size="sm" c="orange">{`Not matched to Plex: ${data.unmatched?.text || 'no Plex film'}. The review and override here are kept; runs are blocked.`}</Text>
        ) : null}
        {data.rows.length ? <ReviewTimeline rows={station.scoped} selectedId={row?.id ?? null} onSelect={(r) => station.pick(r)} /> : null}
        <ReviewKeyBar row={row} tally={station.tally} canUndo={station.canUndo} redoOpen={redoOpen}
          helpOpen={station.helpOpen} onToggleHelp={station.handlers.help} onCloseHelp={station.handlers.escape}
          message={station.message} bleepLevel={station.bleepLevel} previewRecovery={station.previewRecovery} />
        <div className="cf-review">
          <Stack gap="sm" className="cf-review__side">
            <ReviewPlayer ratingKey={ratingKey} />
            {data.rows.length ? <FocusBar row={row} list={station.scoped} onPrev={station.handlers.prev} onNext={station.handlers.next} /> : null}
            {row ? <RowEditor key={row.id} ratingKey={ratingKey} row={row} onChanged={reload} busyText={busyText}
              auditFresh={!!data.audit?.fresh} wordRulings={data.wordRulings || {}} />
              : null}
            {station.flagged ? (
              <Button size="xs" color="orange" variant="light" disabled={Boolean(runBlock)} onClick={station.rework}
                title={busyText ? `${busyText}. Rework is available when it finishes.` : runBlock ? `${runBlock}: runs are blocked.` : 'Send the rows marked redo back through the pipeline (Shift+D)'}>
                Rework {station.flagged} flagged
              </Button>
            ) : null}
            <SignOffPanel signOff={data.signOff} approval={approval} busyText={busyText} />
          </Stack>
          <Stack gap="xs">
            {picked.size ? (
              <Group gap="xs">
                <Button size="compact-xs" loading={sending} disabled={sending || Boolean(runBlock)} onClick={sendBackPicked}>Send back {picked.size} selected</Button>
                <Button size="compact-xs" variant="subtle" onClick={() => setPicked(new Set())}>Clear selection</Button>
              </Group>
            ) : null}
            {notice ? <Text size="sm" role="status">{notice}</Text> : null}
            <ReviewList rows={data.rows} reviewed={data.reviewed} total={data.total} audit={data.audit}
              selectedId={row?.id ?? null} onSelect={station.pick} scope={station.scope} onScope={station.setScope} picked={picked} onPick={pick} sentBack={sentBack}
              emptyText={EMPTY[data.status?.next] || null} />
          </Stack>
        </div>
      </Stack>
    </SectionCard>
  );
}

/** The part in hand: where it sits in the current view, with Previous / Next (also ← / →). */
function FocusBar({ row, list, onPrev, onNext }) {
  if (!row) {
    return (
      <div className="cf-focus" role="group" aria-label="Part under review">
        <Text size="sm">{list.length ? `${list.length} parts in this view. Go through them one at a time, or pick one in the list.` : 'Nothing in this view.'}</Text>
        {list.length ? <Button size="compact-sm" onClick={onNext} aria-label="Start with the first part">Start: part 1 of {list.length} →</Button> : null}
      </div>
    );
  }
  const i = list.findIndex((r) => r.id === row.id);
  const where = i >= 0 ? `Part ${i + 1} of ${list.length}` : 'Not in this view';
  const left = list.filter((r) => !hasVerdict(r) && !plays(r)).length;
  return (
    <div className="cf-focus" role="group" aria-label="Part under review">
      <Button size="compact-sm" variant="default" onClick={onPrev} disabled={i <= 0} aria-label="Previous part">← Prev</Button>
      <Stack gap={0} align="center">
        <Text size="sm" fw={600} className="cf-focus__where">{where}</Text>
        <Text size="xs" c="dimmed">{left ? `${left} filtered still to review in this view` : 'Every filtered part in this view has a verdict'}</Text>
      </Stack>
      <Button size="compact-sm" variant="default" onClick={onNext} disabled={i < 0 || i >= list.length - 1} aria-label="Next part">Next →</Button>
    </div>
  );
}

/** A film the library could not match to Plex: say why; there is no file to review against. */
function UnmatchedFilm({ ratingKey, data }) {
  useEffect(() => { logger.info('review.unmatched', { ratingKey, reason: data.unmatched?.reason ?? null }); }, [ratingKey, data.unmatched?.reason]);
  const name = data.title || `Film ${ratingKey}`;
  return (
    <SectionCard title={data.year ? `${name} (${data.year})` : name}
      actions={<Anchor component={Link} to="/admin/content/filter" size="sm">All films</Anchor>}>
      <Stack gap="xs">
        <Text size="sm">{`Not matched to Plex: ${data.unmatched?.text || 'no Plex film'}.`}</Text>
        <Text size="sm" c="dimmed">This film can't be reviewed against a file, and it can't be run, until Plex has this film
          under the same title and year. Then run <code>contentfilter map</code> to match it.</Text>
      </Stack>
    </SectionCard>
  );
}

export default ReviewPage;
