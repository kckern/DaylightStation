import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Anchor, Stack, Text } from '@mantine/core';
import { useVisibleRefresh } from '../../../lib/hooks/useVisibleRefresh.js';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { previewStore, useFilterPreview } from '../../../../../__app_modules/media/media/browser/content-filter/adminWorkspace.mjs';
import { LoadingState, ErrorState, SectionCard, createAppLogger } from '../../../lib/ui/index.js';
import { ReviewList } from './ReviewList.jsx';
import { ReviewTimeline } from './ReviewTimeline.jsx';
import { ReviewKeyBar } from './ReviewKeyBar.jsx';
import { useReviewKeys } from './useReviewKeys.js';
import { useReviewStation } from './useReviewStation.js';
import { useEffectHolds } from './effectHolds.js';
import { isOpen, plays } from './reviewScope.js';
import { ReviewHeader } from './ReviewHeader.jsx';
import { ReviewPlayer } from './ReviewPlayer.jsx';
import { RowEditor } from './RowEditor.jsx';
import { PartMenu } from './PartMenu.jsx';
import { ApprovePanel, PANEL_ID, ReviewRail, tabId } from './ReviewRail.jsx';
import { useFilmApproval, useFilmReviewOwner } from './useFilmApproval.js';
import './ContentFilterAdmin.scss';

/**
 * Admin -> Content filter -> one film, as a queue of its filtered parts with one part in hand
 * (owner, 2026-11-21; design ops "cf-journey"): one header line, the stage rail (Refine › Review ›
 * Approve, and Plays; its tabs set what the page shows), then the film, the timeline and the part's
 * card in a column that never scrolls, the list beside it.
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
  const { data: served, loading, error, reload, refresh, poll } = useApiResource(url, { label: 'review', logger, dedupe: false });
  // An effect just chosen shows at once, until the re-audit settles it (effectHolds.js).
  const effectHolds = useEffectHolds(served, { rk: String(ratingKey), logger });
  const { data } = effectHolds;
  const [selected, setSelected] = useState(null);
  const [notice, setNotice] = useState(null);
  // Unfiltered is what the player reports (its peek set), never a guessed timer (review 2026-11-22).
  const unfiltered = useFilterPreview().peeking != null;
  // The part card's E (effect menu) and S (save timing), held while the card is mounted.
  const cardPorts = useRef({});
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
  const station = useReviewStation({ ratingKey, data, effectHolds, reload, refreshReview: refresh, selected, select, activeView, runBusy: running || notMatched, openRowId: rowId });
  const stage = station.scope.stage;
  // On Approve the part card is not on screen, so the keys that act on a part are off; Space still
  // plays and pauses the film, and ? still lists the keys.
  const row0 = data?.rows?.find((r) => r.id === selected?.id) || null;
  // Unfiltered (W): the part plays from 4 s before with its effect off; the button and the player
  // say so while the player has it unfiltered (Fable design 2026-11-22: "a way to watch it unfiltered").
  const playUnfiltered = () => {
    if (!row0) return;
    station.handlers.playWithout();
    logger.info('content_filter.review.unfiltered', { rk: ratingKey, rowId: row0.id });
  };
  const keyHandlers = { ...station.handlers, playWithout: playUnfiltered,
    openEffect: () => cardPorts.current.openEffect?.(),
    markIn: () => cardPorts.current.markIn?.(), markOut: () => cardPorts.current.markOut?.() };
  const { redoOpen, openRedo, closeRedo } = useReviewKeys(keyHandlers, {
    enabled: Boolean(data?.rows), partKeys: stage !== 'approve', redoOwner: `${ratingKey}\u001f${selected?.id ?? ''}`,
  });
  useVisibleRefresh({ active: Boolean(waiting), intervalMs: POLL_MS, reload, poll });

  // The part menu (PartMenu.jsx): a right-click on a part anywhere takes it in hand and opens there.
  // An item runs once the cursor is that part, through the same handlers as the keys.
  const [partMenu, setPartMenu] = useState(null);
  const pendingAction = useRef(null);
  const [actionTick, setActionTick] = useState(0);
  // The open menu's row id, read by a second open in the same gesture (the ContextMenu key raises
  // keydown and then contextmenu): one menu, one log.
  const openMenuId = useRef(null);
  const runPartAction = ({ row: r, action, value }) => {
    if (action === 'play') keyHandlers.replay?.();
    else if (action === 'unfiltered') keyHandlers.playWithout();
    else if (action === 'jump') previewStore.jumpToCue({ in: r.in }, { play: false });
    else if (action === 'effect') station.handlers.effect?.(value, r);
    else if (action === 'settings') station.handlers.settings?.(r);
    // Redo asks for its reason like the Redo button and D.
    else if (action === 'verdict') { if (value === 'redo') openRedo(); else keyHandlers.verdict?.(value); }
    else if (action === 'refine') keyHandlers.refine?.();
    else if (action === 'in') keyHandlers.markIn();
    else if (action === 'out') keyHandlers.markOut();
    else if (action === 'bleep-level') cardPorts.current.openBleepLevel?.();
  };
  // An action runs on the render it was queued for, and only on its own part: a cursor that moved
  // meanwhile (a verdict's save stepped on) drops it, so it never fires on a later visit (review 2026-11-22).
  useEffect(() => {
    const p = pendingAction.current;
    if (!p || actionTick < p.tick) return;
    pendingAction.current = null;
    if (selected?.id !== p.row.id) {
      logger.info('content_filter.review.part_menu.dropped', { rk: ratingKey, rowId: p.row.id, action: p.action, cursor: selected?.id ?? null });
      return;
    }
    runPartAction(p);
  });

  const refining = station.refining;
  // Arriving without a permalink: the first filtered part still to review is in hand at once.
  useEffect(() => {
    if (rowId || selected || opened.current || !data?.rows?.length) return;
    const first = station.scoped.find((r) => isOpen(r, station.scope)) || station.scoped[0];
    if (!first) return;
    opened.current = first.id;
    logger.info('content_filter.review.arrived', { rk: ratingKey, rowId: first.id, rows: data.rows.length });
    setSelected(first);
    // The film waits at the part in hand, paused: it used to play from 0:00 under part 1's card.
    previewStore.jumpToCue({ in: first.in }, { play: false });
  }, [rowId, selected, data, ratingKey, station.scoped, station.scope]);

  if (loading && !data) return <LoadingState label="review" rows={6} />;
  if (error && (!data || !approval.blocked)) return <ErrorState error={error} onRetry={reload} label="Review" />;
  if (notMatched && !Array.isArray(data.rows)) return <UnmatchedFilm ratingKey={ratingKey} data={data} />;
  const row = data.rows.find((r) => r.id === selected?.id) || null;
  const busyText = running ? 'A refine is running: effects, timing and the card text can change when it finishes.' : null;
  const roughFiltered = station.roughRefineCount;
  const index = row ? station.scoped.findIndex((r) => r.id === row.id) : -1;
  // Picking a part from the list or the timeline while on Approve goes back to the parts.
  const pickPart = (r) => { if (stage === 'approve') station.setStage(plays(r) ? 'plays' : 'review', 'part', { keepCursor: true }); return station.pick(r); };
  const openPartMenu = (r, at, from) => {
    if (!r || !at) return;
    // The menu acts on the part in hand: when the pick is refused (unsaved timing) it stays shut.
    if (openMenuId.current === r.id) return;
    if ((r.id !== row?.id || stage === 'approve') && pickPart(r) === false) return;
    pendingAction.current = null;
    openMenuId.current = r.id;
    setPartMenu({ id: r.id, row: r, at });
    logger.info('content_filter.review.part_menu', { rk: ratingKey, rowId: r.id, from });
  };
  const partMenuRow = partMenu ? data.rows.find((r) => r.id === partMenu.id) || partMenu.row : null;
  const onPartAction = (action, value) => {
    if (!partMenuRow) return;
    logger.info('content_filter.review.part_menu.action', { rk: ratingKey, rowId: partMenuRow.id, action, value: value ?? null });
    pendingAction.current = { row: partMenuRow, action, value, tick: actionTick + 1 };
    setActionTick(actionTick + 1);
  };
  // The list's keyboard path says so (the context-menu key or Shift+F10).
  const fromList = (r, at, via) => openPartMenu(r, at, via === 'key' ? 'key' : 'list');
  // The redo prompt, the last message and the preview retry sit inside the card, above its verdicts.
  const onRedo = (reason) => { closeRedo(); if (reason !== null) station.handlers.verdict('redo', reason); };
  const keyBar = <ReviewKeyBar redoOpen={redoOpen} helpOpen={station.helpOpen} onCloseHelp={station.handlers.escape}
    message={station.message} previewRecovery={station.previewRecovery} onRedo={onRedo} />;
  // The Redo button asks for a reason like D does.
  const cardHandlers = { ...keyHandlers, redo: openRedo };
  return (
    // A pointer never moves focus on this page (Space then pauses the film and outlines nothing);
    // text fields and menus keep theirs.
    <div className="cf-review-page" onMouseDown={(e) => {
      const t = e.target;
      if (t.closest?.('input, textarea, select, [role="menu"], [role="dialog"]')) return;
      if (t.closest?.('button, [role="slider"], [role="tab"], [data-mark], .cf-timeline__track, .cf-strip__track, .cf-review__player')) e.preventDefault();
    }}>
      <ReviewHeader ratingKey={ratingKey} data={data} stage={stage} roughFiltered={roughFiltered} handlers={{ ...station.handlers, rework: station.rework }} bleep={station.bleep} blocked={notMatched}
        onChanged={reload} flagged={station.flagged} refineAllCount={station.refineAllCount} />
      <ReviewRail stages={station.stages} plays={data.rows.filter(plays).length} value={stage} onChange={station.setStage} />
      {notMatched ? <Text size="sm" c="orange">{`Not matched to Plex: ${data.unmatched?.text || 'no Plex film'}. The review and override here are kept; runs are blocked.`}</Text> : null}
      {notice ? <Text size="sm" role="status">{notice}</Text> : null}
      <div className="cf-review" id={PANEL_ID} role="tabpanel" aria-labelledby={tabId(stage)}>
        <div className="cf-review__side">
          <ReviewPlayer ratingKey={ratingKey} unfiltered={unfiltered} />
          {data.rows.length ? <ReviewTimeline rows={station.scoped} selectedId={row?.id ?? null} onSelect={pickPart}
            onPartMenu={(r, at) => openPartMenu(r, at, 'timeline')} /> : null}
          {stage === 'approve' ? (
            <>
              <ApprovePanel data={data} approval={approval} tally={station.tally} running={running} onReview={() => station.setStage('review', 'approve-panel')} />
              {keyBar}
            </>
          ) : row ? (
            <RowEditor key={row.id} ratingKey={ratingKey} row={row} onChanged={reload} busyText={busyText}
              wordRulings={data.wordRulings || {}} handlers={cardHandlers} canUndo={station.canUndo} stage={stage}
              position={index >= 0 ? { index, total: station.scoped.length } : null}
              refineState={refining[row.id] ? { state: refining[row.id] } : null}
              status={keyBar} neighbours={data.rows} ports={cardPorts} unfiltered={unfiltered}
              onPartMenu={(r, at) => openPartMenu(r, at, 'strip')} filmLevel={station.bleep?.effective ?? null} />
          ) : keyBar}
        </div>
        <ReviewList rows={data.rows} reviewed={data.reviewed} total={data.total} audit={data.audit}
          selectedId={row?.id ?? null} onSelect={pickPart} scope={station.scope} onScope={station.setScope} refining={refining}
          onEffect={stage === 'approve' ? null : (r, letter) => station.handlers.effect?.(letter, r)}
          emptyText={EMPTY[data.status?.next] || null} onPartMenu={fromList} />
      </div>
      <PartMenu row={partMenuRow} at={partMenu?.at ?? null} onClose={() => { openMenuId.current = null; setPartMenu(null); }} onAction={onPartAction} />
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
        <Text size="sm" c="dimmed">This film can&apos;t be reviewed against a file, and it can&apos;t be run, until Plex has this film
          under the same title and year. Then run <code>contentfilter map</code> to match it.</Text>
      </Stack>
    </SectionCard>
  );
}

export default ReviewPage;
