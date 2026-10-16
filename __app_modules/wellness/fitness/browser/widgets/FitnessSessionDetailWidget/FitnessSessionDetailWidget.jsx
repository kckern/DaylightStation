import React, { useState, useEffect, useMemo, useRef, useLayoutEffect, useCallback } from 'react';
import { Text } from '@mantine/core';
import { getWidgetRegistry } from "../../../../../../__capabilities/screen-host/browser/public.mjs";
import { useScreen } from "../../../../../../__capabilities/screen-host/browser/providers.mjs";
import { useScreenData, useScreenDataRefetch } from "../../../../../../__capabilities/screen-host/browser/data.mjs";
import { useFitnessScreen } from "../../useFitnessScreen.js";
import { useFitnessContext } from "../../context/FitnessContext.jsx";
import FitnessTimeline from "./FitnessTimeline.jsx";
import MarkerGutter from "./MarkerGutter.jsx";
import TimelineOverlay from "./TimelineOverlay.jsx";
import { buildSessionAxis, buildSessionMarks } from "./sessionTimeline.js";
import { elapsedMsFromX, xFromElapsedMs, videoTimeFromElapsedMs, elapsedMsFromVideoTime } from "./recapTimeMap.js";
import { positionAtElapsedMs } from "./routeTrack.js";
import { CHART_MARGIN } from "../../lib/chartConstants.js";
import GroupSummaryPanel from "./GroupSummaryPanel.jsx";
import DetailActions from "./DetailActions.jsx";
import SessionDetailSkeleton, { ChartSkeleton, LanesSkeleton } from "./SessionDetailSkeleton.jsx";
import SportIcon from "../_shared/SportIcon.jsx";
import RouteMap from "./RouteMap.jsx";
import "./FitnessSessionDetailWidget.scss";
import { selectVideoMarkerEvents } from "./timelineOverlay.js";
import { headerFromDetail, headerFromListRow, mergeHeaders } from "./sessionHeader.js";
import { useSettledRecapPlay } from "./recapPlayback.js";
import { useRecapUnlock } from "./useRecapUnlock.js";
import { useOptionalIdentity } from "../../identity/useIdentity.js";
import UnlockPrompt from "../../player/overlays/UnlockPrompt.jsx";
import { isKioskEnv } from "@/lib/kioskEnv.js";
import { DaylightAPI } from "@/lib/api.mjs";
import RingIcon from '@/lib/icons/RingIcon.jsx';
import Skeleton from '@/lib/ui/Skeleton.jsx';
import getLogger from '@/lib/logging/Logger.js';

let _logger;
const DELETE_ARM_MS = 3000;

function logger() {
  if (!_logger) _logger = getLogger().child({ app: 'fitness', component: 'session-detail' });
  return _logger;
}

const StravaIcon = ({ size = 12, color = '#fc4c02' }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill={color} style={{ flexShrink: 0 }}>
    <path d="M6.731 0 2 9.125h2.788L6.73 5.497l1.93 3.628h2.766zm4.694 9.125-1.372 2.756L8.66 9.125H6.547L10.053 16l3.484-6.875z" />
  </svg>
);

function FitText({ children, maxSize = 2.4, minSize = 0.8, wrapBelow = 1.3, breakOn, className }) {
  const containerRef = useRef(null);
  const textRef = useRef(null);
  const [fontSize, setFontSize] = useState(maxSize);
  const [twoLine, setTwoLine] = useState(false);

  const textStr = [].concat(children).join('');
  const canBreak = breakOn && textStr.includes(breakOn);

  const fit = useCallback(() => {
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return;

    const available = container.clientWidth;
    const availableHeight = container.clientHeight;
    const brEl = text.querySelector('.fit-break');

    // Phase 1: single-line — hide break, measure
    if (brEl) brEl.style.display = 'none';
    text.style.whiteSpace = 'nowrap';

    let size = maxSize;
    text.style.fontSize = `${size}rem`;
    while (text.scrollWidth > available && size > minSize) {
      size -= 0.05;
      text.style.fontSize = `${size}rem`;
    }

    // Phase 2: if too small and we have a break point, try 2-line
    if (size < wrapBelow && brEl) {
      brEl.style.display = '';
      text.style.whiteSpace = 'normal';
      // Re-fit from maxSize — now two lines gives more room
      size = maxSize;
      text.style.fontSize = `${size}rem`;
      while (size > minSize && (text.scrollWidth > available || text.scrollHeight > availableHeight)) {
        size -= 0.05;
        text.style.fontSize = `${size}rem`;
      }
      setTwoLine(true);
    } else {
      setTwoLine(false);
    }
    setFontSize(size);
  }, [maxSize, minSize, wrapBelow]);

  useLayoutEffect(() => {
    fit();
    const ro = new ResizeObserver(fit);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [fit, children]);

  // Build content: insert a <br/> at the preferred break point
  let content;
  if (canBreak) {
    const idx = textStr.indexOf(breakOn);
    content = (
      <>
        {textStr.slice(0, idx + breakOn.length)}
        <br className="fit-break" style={twoLine ? undefined : { display: 'none' }} />
        {textStr.slice(idx + breakOn.length)}
      </>
    );
  } else {
    content = children;
  }

  return (
    <div ref={containerRef} className={className} style={{ overflow: 'hidden' }}>
      <span ref={textRef} style={{
        fontSize: `${fontSize}rem`,
        whiteSpace: twoLine ? 'normal' : 'nowrap',
        display: 'block',
        lineHeight: 1.15,
        overflow: 'hidden',
      }}>
        {content}
      </span>
    </div>
  );
}

export default function FitnessSessionDetailWidget({ sessionId }) {
  const [sessionData, setSessionData] = useState(null);
  // The session `sessionData` belongs to. While another session loads, the pane
  // keeps showing this one (dimmed) instead of blanking to a skeleton.
  const [dataSessionId, setDataSessionId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const { restore } = useScreen();
  const refetchScreenData = useScreenDataRefetch();
  const sessionsData = useScreenData('sessions');
  const { onNavigate } = useFitnessScreen() || {};
  const fitnessCtx = useFitnessContext();
  const posterRef = useRef(null);
  const [posterWidth, setPosterWidth] = useState(0);

  // The pane stays mounted when it swaps to another session (same widget key),
  // so a response is applied only if it is still for the session on screen.
  const activeSessionIdRef = useRef(sessionId);
  activeSessionIdRef.current = sessionId;

  // `background` refreshes keep the current detail on screen: the skeleton is
  // for a first load only. Swapping a rendered detail back to a skeleton to
  // refresh it is what made the pane blank out and redraw during hydration.
  // Switching sessions keeps the previous detail up too (see `stale` below):
  // most loads finish in ~100ms, and a skeleton flash on every tap was worse
  // than a brief dim of the outgoing session.
  const hasDataRef = useRef(false);
  hasDataRef.current = sessionData != null;
  const fetchSession = useCallback(({ background = false } = {}) => {
    if (!sessionId) return;
    if (!background) {
      if (!hasDataRef.current) setLoading(true);
      setError(null);
    }
    const startedAt = performance.now();
    fetch(`/api/v1/fitness/sessions/${sessionId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (activeSessionIdRef.current !== sessionId) return;
        setSessionData(data.session || data);
        setDataSessionId(sessionId);
        setError(null);
        setLoading(false);
        logger().info('session-detail.loaded', {
          sessionId, background, ms: Math.round(performance.now() - startedAt),
        });
      })
      .catch((err) => {
        if (activeSessionIdRef.current !== sessionId) return;
        if (background) {
          logger().warn('session-detail.refresh-failed', { sessionId, error: err.message });
          return;
        }
        logger().warn('session-detail.load-failed', { sessionId, error: err.message });
        setError(err.message);
        setLoading(false);
      });
  }, [sessionId]);

  // Delete takes two taps: the first arms it ("Delete?") for a few seconds. One
  // stray touch on a kiosk must never delete a workout.
  const disarmTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(disarmTimerRef.current), []);
  useEffect(() => { setDeleteArmed(false); clearTimeout(disarmTimerRef.current); }, [sessionId]);
  const handleDelete = useCallback(async () => {
    if (!sessionId || deleting) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      clearTimeout(disarmTimerRef.current);
      disarmTimerRef.current = setTimeout(() => setDeleteArmed(false), DELETE_ARM_MS);
      logger().info('session-detail.delete-armed', { sessionId });
      return;
    }
    clearTimeout(disarmTimerRef.current);
    setDeleteArmed(false);
    logger().info('session-detail.delete-confirmed', { sessionId });
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/fitness/sessions/${sessionId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`${res.status}`);
      await refetchScreenData?.('sessions');
      restore('right-area');
    } catch (err) {
      setDeleting(false);
      setError(`Delete failed: ${err.message}`);
    }
  }, [sessionId, deleting, deleteArmed, restore, refetchScreenData]);

  const handleAddVoiceMemo = useCallback(() => {
    if (!sessionId) return;
    fitnessCtx?.openVoiceMemoCapture?.(null, {
      sessionId,
      onComplete: () => fetchSession({ background: true })
    });
  }, [sessionId, fitnessCtx, fetchSession]);

  useLayoutEffect(() => {
    const el = posterRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setPosterWidth(Math.round(entry.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  // This session's row in the home sessions list. When the row changes (the
  // final save landed, a memo was transcribed, Strava matched) the detail is
  // refreshed in the background. A list refresh that leaves the row untouched
  // — the 5-minute poll, another session saving — does not refetch the detail.
  // `undefined` = list not loaded yet; null = loaded, session not in it.
  const listRow = useMemo(() => {
    if (!sessionsData) return undefined;
    const row = (sessionsData.sessions || []).find((s) => s.sessionId === sessionId);
    return row ? JSON.stringify(row) : null;
  }, [sessionsData, sessionId]);
  const lastListRowRef = useRef(null);
  useEffect(() => {
    const prev = lastListRowRef.current;
    lastListRowRef.current = { sessionId, row: listRow };
    if (!prev || prev.sessionId !== sessionId) return;
    if (prev.row === undefined || listRow === undefined || prev.row === listRow) return;
    logger().debug('session-detail.list-row-changed', { sessionId });
    fetchSession({ background: true });
  }, [sessionId, listRow, fetchSession]);

  const detailHeader = useMemo(
    () => (sessionData ? headerFromDetail(sessionData, fitnessCtx?.plexConfig) : null),
    [sessionData, fitnessCtx?.plexConfig]
  );
  // The tapped session's header comes straight from its home-list row; only the
  // detail-only parts (charts, lanes, recap video, Strava stats) wait for the fetch.
  const listRowData = useMemo(
    () => (listRow ? JSON.parse(listRow) : null),
    [listRow]
  );
  const previewHeader = useMemo(() => headerFromListRow(listRowData), [listRowData]);
  // `current`: the loaded detail is the session on screen. `pending`: it is not
  // (yet), but the list row lets us show this session's header now.
  const current = sessionData != null && dataSessionId === sessionId;
  const pending = !current && previewHeader != null;
  // No row for it either (a deep link): keep the outgoing session up, dimmed.
  const stale = !current && !pending && sessionData != null;
  const header = current ? mergeHeaders(detailHeader, previewHeader) : (previewHeader || detailHeader);
  const detail = (current || stale) ? sessionData : null;

  // The recap shows the episode in picture-in-picture, so a session that played
  // protected replay content (fitness.yml → playback_unlock, session_recaps)
  // requires a fingerprint to watch from Home. Live episodes use exercise governance.
  // No IdentityProvider (widget rendered outside the fitness app): a gated recap
  // stays locked — there is no reader to unlock it with.
  const identity = useOptionalIdentity();
  const registerUnlock = identity?.registerUnlock;
  const { unlockState, unlockedUser, clearUnlock } = identity || {};
  const unlockRules = useMemo(() => {
    const cfg = fitnessCtx?.fitnessConfiguration || {};
    return cfg.playback_unlock || cfg.fitness?.playback_unlock || null;
  }, [fitnessCtx?.fitnessConfiguration]);
  const unlockLockActive = useMemo(() => {
    const cfg = fitnessCtx?.fitnessConfiguration || {};
    const locks = cfg.locks || cfg.fitness?.locks || {};
    const name = unlockRules?.lock;
    return Boolean(name) && isKioskEnv() && Array.isArray(locks[name]) && locks[name].length > 0;
  }, [fitnessCtx?.fitnessConfiguration, unlockRules]);
  // One time axis + one mark list for the chart · gutter · lanes stack.
  const axis = useMemo(() => buildSessionAxis(detail), [detail]);
  const rootRef = useRef(null);
  const chartRef = useRef(null);
  const timelineRef = useRef(null);
  // The overlay spans from the chart's plot top to the lanes' bottom.
  const [stackBox, setStackBox] = useState(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const measure = () => {
      const c = chartRef.current;
      const tl = timelineRef.current;
      if (!c || !tl) { setStackBox(null); return; }
      const top = c.offsetTop + CHART_MARGIN.top;
      const next = { width: root.clientWidth, top, height: tl.offsetTop + tl.offsetHeight - top };
      setStackBox((prev) => (prev && prev.width === next.width && prev.top === next.top && prev.height === next.height ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    [root, chartRef.current, timelineRef.current].forEach((el) => el && ro.observe(el));
    return () => ro.disconnect();
  }, [detail]);
  const marks = useMemo(
    () => (detail && axis && stackBox ? buildSessionMarks(detail, axis, stackBox.width, header?.primaryMediaKey) : null),
    [detail, axis, stackBox, header?.primaryMediaKey]
  );

  const sessionMedia = detail?.summary?.media || null;
  const fetchRecapInfo = useCallback((plexId) => DaylightAPI(`api/v1/info/plex/${plexId}`), []);
  const recapUnlock = useRecapUnlock({
    sessionId,
    media: sessionMedia,
    rules: unlockRules,
    active: unlockLockActive && !!header?.hasRecap,
    registerUnlock,
    clearUnlock,
    fetchInfo: fetchRecapInfo,
  });
  const recapViewable = !!header?.hasRecap && !recapUnlock.locked;

  const { videoRef: recapVideoRef } = useSettledRecapPlay({ enabled: recapViewable, srcKey: header?.recapUrl });

  // Recap ↔ chart time cursor (recapTimeMap.js): a tap on the chart, gutter or lanes
  // seeks the recap to that moment, and a playhead on the stack follows the recap.
  // Single sessions only (a merged group has no recap, and its axis is gap-compressed).
  const recapSpeedup = header?.recapSpeedup;
  const recapSeekable = recapViewable && current && !header?.isGroup && recapSpeedup > 0;
  // A route with time on it (strava.map.track): the same cursor places the rider on the map.
  const routeTrack = current ? (detail?.strava?.map?.track || null) : null;
  const cursorEnabled = recapSeekable || !!routeTrack;
  const [playheadMs, setPlayheadMs] = useState(null);
  // One focused rider for the rings chart and the HR lanes: tapping either
  // avatar focuses that rider in both (tap again to clear).
  const [focusedRider, setFocusedRider] = useState(null);
  useEffect(() => { setPlayheadMs(null); setFocusedRider(null); }, [sessionId]);
  const toggleRiderFocus = useCallback((id) => {
    setFocusedRider((prev) => (prev === id ? null : id));
    logger().info('session-detail.rider-focus', { sessionId, userId: id, source: 'lane' });
  }, [sessionId]);
  useEffect(() => {
    const v = recapVideoRef.current;
    if (!recapSeekable || !v) return undefined;
    const onTime = () => setPlayheadMs(elapsedMsFromVideoTime(v.currentTime, recapSpeedup));
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('seeked', onTime);
    onTime();
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('seeked', onTime);
    };
  }, [recapSeekable, recapSpeedup, header?.recapUrl, recapVideoRef]);

  const handleStackPointer = useCallback((e) => {
    if (!cursorEnabled || !axis || !stackBox) return;
    const target = e.target;
    if (target.closest?.('button, a, .race-chart__focus-filter, .race-chart__avatar-group, .fitness-timeline__avatar, .marker-gutter__chip')) return;
    // On a map session the chart row is the map, which pans on drag: only the
    // gutter and lanes set the time there.
    const zones = header?.stravaHasMap
      ? '.session-detail__gutter, .session-detail__timeline'
      : '.session-detail__chart, .session-detail__gutter, .session-detail__timeline';
    if (!target.closest?.(zones)) return;
    const root = rootRef.current;
    if (!root) return;
    const x = e.clientX - root.getBoundingClientRect().left;
    const ms = elapsedMsFromX(x, axis, stackBox.width);
    if (ms == null) return;
    setPlayheadMs(ms);
    const v = recapVideoRef.current;
    let videoTime = null;
    if (recapSeekable && v) {
      videoTime = videoTimeFromElapsedMs(ms, recapSpeedup, v.duration);
      v.currentTime = videoTime;
    }
    logger().info('session-detail.time-cursor', {
      sessionId, elapsedMs: Math.round(ms),
      videoTime: videoTime == null ? null : Math.round(videoTime * 100) / 100,
      route: !!routeTrack,
    });
  }, [cursorEnabled, axis, stackBox, header?.stravaHasMap, recapSeekable, recapSpeedup, recapVideoRef, routeTrack, sessionId]);
  const routeCursor = routeTrack && playheadMs != null ? positionAtElapsedMs(routeTrack, playheadMs) : null;

  // The recap is a muted, looping timelapse — glanceable, not scrub-worthy. Tap
  // toggles native (edge-to-edge) fullscreen symmetrically: tap the thumb to ENTER,
  // tap the fullscreen video to EXIT. Kept chrome-free (no native scrubber) so the
  // exit tap is unambiguous and no keyboard is needed on the kiosk — Esc still
  // works as a desktop fallback. This matches the tap-to-toggle model used by every
  // other video surface (the main player expands/collapses on tap the same way).
  const toggleRecapFullscreen = useCallback(() => {
    const el = recapVideoRef.current;
    if (!el) return;
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) {
      (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
    } else {
      (el.requestFullscreen || el.webkitRequestFullscreen || el.webkitEnterFullscreen)?.call(el);
    }
  }, [recapVideoRef]);

  if (!sessionData && !previewHeader) {
    return <SessionDetailSkeleton />;
  }

  if (error) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <Text c="red" size="sm">Failed to load session: {error}</Text>
        <Text
          size="sm"
          c="dimmed"
          mt="md"
          style={{ cursor: 'pointer', textDecoration: 'underline' }}
          onClick={() => restore('right-area')}
        >
          Back to dashboard
        </Text>
      </div>
    );
  }

  const registry = getWidgetRegistry();
  const ChartComponent = registry.get('fitness:chart');

  // The center gutter holds only video-change cards now (challenge badges live at the
  // top of the line chart), so it earns its 66px only when a card will actually render.
  // Same selection the gutter uses, so the band never opens empty. Strava-map sessions
  // never show it.
  const events = detail?.timeline?.events;
  const hasVideoChanges = !!detail && !header?.stravaHasMap &&
    selectVideoMarkerEvents(events, header?.primaryMediaKey).length > 0;

  const shownSessionId = stale ? dataSessionId : sessionId;
  const actions = (
    <DetailActions
      onClose={() => restore('right-area')}
      onDelete={handleDelete}
      deleting={deleting}
      deleteArmed={deleteArmed}
      onAddMemo={handleAddVoiceMemo}
    />
  );

  return (
    <div
      ref={rootRef}
      onPointerDown={handleStackPointer}
      className={`session-detail${stale ? ' session-detail--stale' : ''}${pending ? ' session-detail--pending' : ''}${cursorEnabled ? ' session-detail--seekable' : ''}`}
      aria-busy={(stale || pending) || undefined}
    >
      {/* Header (25%) */}
      <div className="session-detail__header">
        {header?.posterUrl ? (
          <div
            ref={posterRef}
            className={`session-detail__poster${header.grandparentId && onNavigate ? ' session-detail__poster--clickable' : ''}`}
            onClick={header.grandparentId && onNavigate ? () => onNavigate('show', { contentId: header.grandparentId }) : undefined}
          >
            <img
              src={header.posterUrl}
              alt=""
              onError={(e) => { e.target.style.display = 'none'; }}
            />
          </div>
        ) : header?.activityPoster ? (
          (() => {
            const P = header.activityPoster;
            return (
              <div
                ref={posterRef}
                className="session-detail__poster session-detail__poster--placeholder session-detail__poster--activity"
                style={header.activityAccent ? { color: header.activityAccent } : undefined}
              >
                <P />
              </div>
            );
          })()
        ) : (
          <div ref={posterRef} className="session-detail__poster session-detail__poster--placeholder">
            <SportIcon
              type={header?.stravaType}
              sessionId={shownSessionId}
              variant="detail"
            />
          </div>
        )}

        <div className="session-detail__meta">
          <FitText className="session-detail__hero" maxSize={2.4} minSize={0.9} wrapBelow={1.5} breakOn={" \u2014 "}>
            {header?.showTitle
              ? `${header.showTitle} \u2014 ${header.title}`
              : header?.title}
          </FitText>
          <div className="session-detail__meta-bottom">
            <div className="session-detail__stats-row">
              {(() => {
                // Build only the present meta items, then interleave separators — no dangling
                // "·" when time/duration/rings are missing (e.g. merged race-group sessions).
                // The totals (rings, suffer) are one unbreakable group set off by a gap, not a
                // dot: when the line is too narrow the group wraps whole, and no separator is
                // left hanging at a line end.
                const items = [];
                if (header?.date) items.push(<span key="date" className="session-detail__meta-item">{header.date}</span>);
                if (header?.time) items.push(
                  <span key="time" className="session-detail__meta-item">
                    {header.endTime ? `${header.time} – ${header.endTime}` : header.time}
                  </span>
                );
                if (header?.elapsedLabel) items.push(<span key="dur" className="session-detail__meta-item">{header.elapsedLabel}</span>);
                if (header?.isGroup && header?.raceCount > 0) items.push(<span key="races" className="session-detail__meta-item">{header.raceCount} races</span>);
                const totals = [];
                if (header?.totalRings > 0) totals.push(<span key="rings" className="session-detail__meta-item session-detail__rings"><RingIcon size={14} /> {header.totalRings}</span>);
                if (header?.sufferScore != null) totals.push(
                  header.stravaActivityId
                    ? <a key="suffer" href={`https://www.strava.com/activities/${header.stravaActivityId}`} target="_blank" rel="noopener noreferrer" className="session-detail__meta-item session-detail__suffer"><StravaIcon size={14} /> {header.sufferScore}</a>
                    : <span key="suffer" className="session-detail__meta-item session-detail__suffer"><StravaIcon size={14} /> {header.sufferScore}</span>
                );
                const timing = items.length > 0 && (
                  <span key="timing" className="session-detail__meta-timing">
                    {items.flatMap((node, i) => i === 0 ? [node] : [<span key={`sep${i}`} className="session-detail__meta-sep" />, node])}
                  </span>
                );
                return [timing, totals.length > 0 && <span key="totals" className="session-detail__meta-totals">{totals}</span>];
              })()}
            </div>
            <div className="session-detail__measured-row">
              {header?.riders?.filter((rider) => rider.measuredDurationMs > 0).map((rider) => (
                <span key={rider.id}>{rider.name} {Math.max(1, Math.round(rider.measuredDurationMs / 60000))}m measured</span>
              ))}
              {shownSessionId && (
                <code
                  className="session-detail__session-id"
                  onClick={() => navigator.clipboard?.writeText(shownSessionId)}
                  title="Click to copy session ID"
                >{shownSessionId}</code>
              )}
            </div>
            {(header?.voiceMemos?.length > 0 || header?.stravaNotes) && (
              <div className="session-detail__memos">
                {/* One clamped block for all memos (joined like the list row): each memo
                    clamping on its own let two of them overflow and cut the second mid-line. */}
                {header.voiceMemos?.length > 0 && (
                  <div className="session-detail__memo">
                    <span className="session-detail__memo-icon">{'\uD83C\uDF99'}</span>
                    <span className="session-detail__memo-text">
                      {header.voiceMemos.map((memo) => memo.transcript).join(' \u2022 ')}
                    </span>
                  </div>
                )}
                {header.stravaNotes && !header.voiceMemos?.length && (
                  <div className="session-detail__memo">
                    <span className="session-detail__memo-icon">{'\uD83D\uDCDD'}</span>
                    <span className="session-detail__memo-text">{header.stravaNotes}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* A group keeps its rider summary (who rode, blocks sandwiched) unless it has a recap. */}
        {(header?.hasRecap || (header?.thumbUrl && !header?.isGroup)) ? (
          <div className="session-detail__thumb">
            {header?.hasRecap && recapUnlock.locked ? (
              <button
                type="button"
                className="session-detail__recap-locked"
                onPointerDown={recapUnlock.request}
                aria-label="Recap locked — scan to watch"
              >
                {header.thumbUrl && <img src={header.thumbUrl} alt="" onError={(e) => { e.target.style.display = 'none'; }} />}
                <span className="session-detail__recap-lock-badge">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor" />
                    <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" fill="none" />
                  </svg>
                </span>
              </button>
            ) : header?.hasRecap ? (
              <video
                key={header.recapUrl}
                ref={recapVideoRef}
                data-activity-probe="ignore"
                className="session-detail__thumb-video"
                src={header.recapUrl}
                poster={header.thumbUrl || undefined}
                muted
                loop
                playsInline
                preload="metadata"
                onPointerDown={toggleRecapFullscreen}
                style={{ cursor: 'pointer' }}
              />
            ) : (
              <img
                src={header.thumbUrl}
                alt=""
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            )}
            {header?.recapProcessing && !header?.hasRecap && (
              <div className="session-detail__recap-processing">Recap rendering…</div>
            )}
            {actions}
            {header?.description && (
              <div className="session-detail__thumb-desc">
                <span>{header.description}</span>
              </div>
            )}
          </div>
        ) : header?.pendingStrava && pending ? (
          // Strava stats need the detail (moving time, max HR, elevation gain).
          <div className="session-detail__thumb session-detail__thumb--strava-stats">
            {actions}
            <Skeleton className="session-detail__thumb-pending" radius="sm" />
          </div>
        ) : detail?.strava ? (
          <div className="session-detail__thumb session-detail__thumb--strava-stats">
            {actions}
            <div className="session-detail__strava-stats">
              {detail.strava.distance > 0 && (
                <div className="session-detail__stat">
                  <span className="session-detail__stat-value">{(detail.strava.distance / 1000).toFixed(1)}</span>
                  <span className="session-detail__stat-label">km</span>
                </div>
              )}
              {detail.strava.movingTime > 0 && (
                <div className="session-detail__stat">
                  <span className="session-detail__stat-value">{Math.round(detail.strava.movingTime / 60)}</span>
                  <span className="session-detail__stat-label">min</span>
                </div>
              )}
              {detail.strava.avgHeartrate && (
                <div className="session-detail__stat">
                  <span className="session-detail__stat-value">{Math.round(detail.strava.avgHeartrate)}</span>
                  <span className="session-detail__stat-label">avg HR</span>
                </div>
              )}
              {detail.strava.maxHeartrate && (
                <div className="session-detail__stat">
                  <span className="session-detail__stat-value">{Math.round(detail.strava.maxHeartrate)}</span>
                  <span className="session-detail__stat-label">max HR</span>
                </div>
              )}
              {detail.strava.totalElevationGain > 0 && (
                <div className="session-detail__stat">
                  <span className="session-detail__stat-value">{Math.round(detail.strava.totalElevationGain)}</span>
                  <span className="session-detail__stat-label">m elev</span>
                </div>
              )}
            </div>
          </div>
        ) : (header?.isGroup || header?.riders?.length > 0) ? (
          // No video to show: who rode fills the box instead of an empty panel.
          <GroupSummaryPanel
            riders={header.riders}
            segmentCount={header.isGroup ? header.segmentCount : 0}
            elapsedMs={header.elapsedMs}
            actions={actions}
          />
        ) : (
          <div className="session-detail__thumb session-detail__thumb--placeholder">
            {actions}
          </div>
        )}
      </div>

      {/* Every vertical mark, once, full height behind chart · gutter · lanes */}
      {detail && stackBox && (
        <TimelineOverlay
          marks={marks}
          width={stackBox.width}
          top={stackBox.top}
          height={stackBox.height}
          playheadX={playheadMs != null ? xFromElapsedMs(playheadMs, axis, stackBox.width) : null}
        />
      )}

      {/* Chart (40%) */}
      <div ref={chartRef} className="session-detail__chart">
        {!detail ? (
          <ChartSkeleton />
        ) : header?.stravaHasMap ? (
          <RouteMap
            cursor={routeCursor}
            polyline={detail.strava?.map?.polyline}
            sessionId={sessionId}
            distance={detail.strava?.distance}
            elevation={detail.strava?.totalElevationGain}
          />
        ) : ChartComponent ? (
          <ChartComponent
            sessionData={detail}
            mode="standalone"
            primaryMediaKey={header?.primaryMediaKey}
            axisTicks={axis?.effectiveTicks}
            marks={marks}
            avatarSizing="fit"
            showFocusLegend={false}
            focusUserId={focusedRider}
            onFocusChange={setFocusedRider}
          />
        ) : (
          <Text c="dimmed" ta="center" py="xl">Chart not available</Text>
        )}
      </div>

      {/* Marker gutter — icons + labels live here; charts above/below draw the indicators */}
      {hasVideoChanges && (
        <div className="session-detail__gutter">
          <MarkerGutter videoMarkers={marks?.videos || []} />
        </div>
      )}

      {/* Timeline (35%) */}
      <div ref={timelineRef} className="session-detail__timeline">
        {detail
          ? (
            <FitnessTimeline
              sessionData={detail}
              maxAvatarSize={posterWidth}
              effectiveTicks={axis?.effectiveTicks}
              focusedUserId={focusedRider}
              onAvatarTap={(detail?.participants && Object.keys(detail.participants).length > 1) || header?.isGroup ? toggleRiderFocus : null}
            />
          )
          : <LanesSkeleton count={Math.max(1, Math.min(header?.riders?.length || 3, 6))} />}
      </div>

      <UnlockPrompt
        open={recapUnlock.promptOpen}
        state={unlockState}
        lockLabel={header?.showTitle || header?.title || 'Session recap'}
        unlockedUser={unlockedUser}
        onCancel={recapUnlock.cancel}
        {...(recapUnlock.promptTimeoutMs ? { timeoutMs: recapUnlock.promptTimeoutMs } : {})}
      />
    </div>
  );
}
