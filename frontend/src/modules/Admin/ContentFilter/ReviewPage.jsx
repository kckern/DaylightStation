import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Anchor, Stack, Text } from '@mantine/core';
import { useVisibleRefresh } from '../../../lib/hooks/useVisibleRefresh.js';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { previewStore } from '../../../../../__app_modules/media/media/browser/content-filter/adminWorkspace.mjs';
import { LoadingState, ErrorState, SectionCard, createAppLogger } from '../../../lib/ui/index.js';
import { ReviewList } from './ReviewList.jsx';
import { ReviewTimeline } from './ReviewTimeline.jsx';
import { ReviewKeyBar } from './ReviewKeyBar.jsx';
import { useReviewKeys } from './useReviewKeys.js';
import { useReviewStation } from './useReviewStation.js';
import { isOpen, isSceneRow, plays } from './reviewScope.js';
import { ReviewHeader } from './ReviewHeader.jsx';
import { ReviewPlayer } from './ReviewPlayer.jsx';
import { RowEditor } from './RowEditor.jsx';
import { SignOffPanel } from './SignOffPanel.jsx';
import { useFilmApproval, useFilmReviewOwner } from './useFilmApproval.js';
import './ContentFilterAdmin.scss';

/**
 * Admin -> Content filter -> one film, as a queue of its filtered parts with one part in hand
 * (owner, 2026-11-21; design ops "cf-journey"): one header line, the film, the timeline and the
 * part's card in a column that never scrolls, the list beside it. Plays sit on their own tab.
 */
const logger = createAppLogger('admin').child('content-filter');
const API = 'api/v1/content-filter';
const POLL_MS = 3000;
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
  const [notice, setNotice] = useState(null);
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

  const refining = station.refining;
  // Arriving without a permalink: the first filtered part still to review is in hand at once.
  useEffect(() => {
    if (rowId || selected || opened.current || !data?.rows?.length) return;
    const first = station.scoped.find((r) => isOpen(r, station.scope)) || station.scoped[0];
    if (!first) return;
    opened.current = first.id;
    logger.info('content_filter.review.arrived', { rk: ratingKey, rowId: first.id, rows: data.rows.length });
    setSelected(first);
  }, [rowId, selected, data, ratingKey, station.scoped, station.scope]);

  if (loading && !data) return <LoadingState label="review" rows={6} />;
  if (error && (!data || !approval.blocked)) return <ErrorState error={error} onRetry={reload} label="Review" />;
  if (notMatched && !Array.isArray(data.rows)) return <UnmatchedFilm ratingKey={ratingKey} data={data} />;
  const row = data.rows.find((r) => r.id === selected?.id) || null;
  const busyText = running ? 'A refine is running: effects, timing and the card text can change when it finishes.' : null;
  const roughFiltered = data.rows.filter((r) => !plays(r) && !isSceneRow(r) && r.timing === 'rough').length;
  const index = row ? station.scoped.findIndex((r) => r.id === row.id) : -1;
  const allDone = station.tally.total > 0 && station.tally.done === station.tally.total;
  // The redo prompt, the last message and the preview retry sit inside the card, above its verdicts.
  const keyBar = <ReviewKeyBar redoOpen={redoOpen} helpOpen={station.helpOpen} onCloseHelp={station.handlers.escape}
    message={station.message} previewRecovery={station.previewRecovery} />;
  return (
    <div className="cf-review-page">
      <ReviewHeader ratingKey={ratingKey} data={data} tally={station.tally} roughFiltered={roughFiltered} handlers={{ ...station.handlers, rework: station.rework }} blocked={notMatched}
        approval={approval} onChanged={reload} flagged={station.flagged} />
      {notMatched ? <Text size="sm" c="orange">{`Not matched to Plex: ${data.unmatched?.text || 'no Plex film'}. The review and override here are kept; runs are blocked.`}</Text> : null}
      {notice ? <Text size="sm" role="status">{notice}</Text> : null}
      {roughFiltered && !running && !notMatched ? (
        // Review on rough timing is allowed, but a refine moves a part and drops its verdict (review 2026-11-21).
        <Text size="sm" className="cf-head__note">{`Refine first: ${roughFiltered} filtered part${roughFiltered === 1 ? ' is' : 's are'} still on rough timing, and a verdict on a part resets when it is refined. Approval needs refined timing.`}</Text>
      ) : null}
      <div className="cf-review">
        <div className="cf-review__side">
          <ReviewPlayer ratingKey={ratingKey} />
          {data.rows.length ? <ReviewTimeline rows={station.scoped} selectedId={row?.id ?? null} onSelect={(r) => station.pick(r)} /> : null}
          {allDone ? (
            <div className="cf-signoff-card">
              <Text fw={600} size="sm">{data.signOff?.parent ? 'Approved for family.' : data.status?.next === 'approve'
                ? 'Every filtered part has a verdict. Approve for family at the top.' : 'Every filtered part has a verdict. Before approval:'}</Text>
              <SignOffPanel signOff={data.signOff} approval={approval} busyText={running ? 'A run is open' : null} />
            </div>
          ) : null}
          {row ? (
            <RowEditor key={row.id} ratingKey={ratingKey} row={row} onChanged={reload} busyText={busyText}
              wordRulings={data.wordRulings || {}} handlers={station.handlers} canUndo={station.canUndo}
              position={index >= 0 ? { index, total: station.scoped.length } : null}
              refineState={refining[row.id] ? { state: refining[row.id] } : null}
              status={keyBar} />
          ) : keyBar}
        </div>
        <ReviewList rows={data.rows} reviewed={data.reviewed} total={data.total} audit={data.audit}
          selectedId={row?.id ?? null} onSelect={station.pick} scope={station.scope} onScope={station.setScope} refining={refining}
          emptyText={EMPTY[data.status?.next] || null} />
      </div>
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
