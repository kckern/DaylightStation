import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Text, Stack } from '@mantine/core';
import { useScreenData } from '@/screen-framework/data/useScreenData.js';
import { useScreen } from '@/screen-framework/providers/useScreen.js';
import { DashboardCard } from '../_shared/DashboardCard.jsx';
import { useFitnessScreen } from '@/modules/Fitness/useFitnessScreen.js';
import SportIcon from '../_shared/SportIcon.jsx';
import { formatSportType } from '../_shared/sportIconUtils.js';
import MiniRouteMap from './MiniRouteMap.jsx';
import RecapChip from './RecapChip.jsx';
import './FitnessSessionsWidget.scss';
import { formatFitnessDate } from '@/modules/Fitness/lib/dateFormatter.js';
import { resolveSessionTitle, resolveSessionActivity } from './sessionDisplay.js';
import { SESSION_DETAIL_NODE_ID, sessionDetailSubtree, openSessionIdOf } from './sessionDetailPane.js';
import RingIcon from '@/lib/icons/RingIcon.jsx';

const StravaIcon = ({ size = 12, color = '#fff' }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill={color} style={{ flexShrink: 0 }}>
    <path d="M6.731 0 2 9.125h2.788L6.73 5.497l1.93 3.628h2.766zm4.694 9.125-1.372 2.756L8.66 9.125H6.547L10.053 16l3.484-6.875z" />
  </svg>
);


/**
 * Build display URL from a media ID that may or may not be namespaced.
 */
function mediaDisplayUrl(contentId) {
  if (!contentId) return null;
  const str = String(contentId);
  if (str.includes(':')) {
    const [source, id] = str.split(':', 2);
    return `/api/v1/display/${source}/${id}`;
  }
  return `/api/v1/display/plex/${str}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  if (dateStr === todayStr) return 'Today';
  if (dateStr === yesterdayStr) return 'Yesterday';
  return formatFitnessDate(dateStr + 'T12:00:00');
}

// ─── Sessions Card ─────────────────────────────────────────

function SessionsCardSkeleton() {
  return (
    <DashboardCard title="Recent Sessions" className="dashboard-card--workouts">
      <Stack gap="xs">
        <div className="skeleton shimmer" style={{ height: 14, width: 100, borderRadius: 4 }} />
        {[0, 1, 2].map(i => (
          <div key={i} className="session-row session-row--skeleton">
            <div className="session-row__top">
              <div className="session-poster skeleton shimmer" />
              <div className="session-row__info">
                <div className="skeleton shimmer" style={{ height: 12, width: '60%', borderRadius: 3 }} />
                <div className="skeleton shimmer" style={{ height: 10, width: '80%', borderRadius: 3 }} />
                <div className="skeleton shimmer" style={{ height: 10, width: '40%', borderRadius: 3 }} />
              </div>
            </div>
          </div>
        ))}
      </Stack>
    </DashboardCard>
  );
}

function SessionsCard({ sessions, loading, onSessionClick, selectedSessionId }) {
  if (loading) {
    return <SessionsCardSkeleton />;
  }

  if (!sessions || sessions.length === 0) {
    return (
      <DashboardCard title="Recent Sessions" className="dashboard-card--workouts">
        <Text c="dimmed" ta="center" py="md">No recent sessions</Text>
      </DashboardCard>
    );
  }

  const groups = [];
  let currentDate = null;
  for (const s of sessions) {
    if (s.date !== currentDate) {
      currentDate = s.date;
      groups.push({ date: s.date, label: formatDate(s.date), sessions: [] });
    }
    groups[groups.length - 1].sessions.push(s);
  }
  for (const g of groups) g.sessions.reverse();

  return (
    <DashboardCard title={null} className="dashboard-card--workouts">
      <Stack gap={4}>
        {groups.map((group) => (
          <div key={group.date} data-date={group.date}>
            <Text size="xs" fw={600} c="dimmed" tt="uppercase" className="session-date-header">
              {group.label}
            </Text>
            {group.sessions.map((s) => {
              const pm = s.media?.primary;
              const sessionTitle = resolveSessionTitle(s);
              const sessionActivity = resolveSessionActivity(s);
              const bgUrl = pm?.grandparentId
                ? mediaDisplayUrl(pm.contentId)
                : null;
              return (
                <div
                  key={s.sessionId}
                  ref={s.sessionId === selectedSessionId ? (el) => {
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  } : undefined}
                  className={`session-row${bgUrl ? ' session-row--has-bg' : ''}${s.sessionId === selectedSessionId ? ' session-row--selected' : ''}`}
                  style={bgUrl ? { backgroundImage: `url(${bgUrl})` } : undefined}
                  onPointerDown={() => onSessionClick?.(s.sessionId)}
                >
                  <div className="session-row__top">
                    {pm?.grandparentId ? (
                      <img
                        src={mediaDisplayUrl(pm.grandparentId)}
                        alt=""
                        className="session-poster"
                        onError={(e) => { e.target.replaceWith(Object.assign(document.createElement('div'), { className: 'session-poster session-poster--placeholder session-poster--fallback' })); }}
                      />
                    ) : pm?.contentId ? (
                      <img
                        src={mediaDisplayUrl(pm.contentId)}
                        alt=""
                        className="session-poster"
                        onError={(e) => { e.target.replaceWith(Object.assign(document.createElement('div'), { className: 'session-poster session-poster--placeholder session-poster--fallback' })); }}
                      />
                    ) : s.strava?.mapPolyline ? (
                      <div className="session-poster session-poster--map">
                        <MiniRouteMap polyline={s.strava.mapPolyline} sessionId={s.sessionId} />
                      </div>
                    ) : sessionActivity ? (
                      (() => {
                        const P = sessionActivity.display.Poster;
                        return (
                          <div className="session-poster session-poster--activity" style={{ color: sessionActivity.display.accent }}>
                            <P />
                          </div>
                        );
                      })()
                    ) : (
                      <div className="session-poster">
                        <SportIcon
                          type={s.strava?.type}
                          sessionId={s.sessionId}
                          variant="poster"
                        />
                      </div>
                    )}

                    {s.hasVideo && <RecapChip />}

                    <div className="session-row__info">
                      <div className="session-row__title-line">
                        {pm?.showTitle && (
                          <div className="session-row__show-line">
                            {s.durationMs > 0 && (
                              <span className="session-row__duration-badge">
                                {Math.round(s.durationMs / 60000)}m
                              </span>
                            )}
                            <Text size="xs" c="dimmed" truncate="end" title={pm.showTitle}>
                              {pm.showTitle}
                            </Text>
                          </div>
                        )}
                        {!pm?.showTitle && s.strava?.type && (
                          <div className="session-row__show-line">
                            {s.durationMs > 0 && (
                              <span className="session-row__duration-badge">
                                {Math.round(s.durationMs / 60000)}m
                              </span>
                            )}
                            <Text size="xs" c="dimmed" truncate="end">
                              {formatSportType(s.strava.type)}
                            </Text>
                          </div>
                        )}
                        {!pm?.showTitle && !s.strava?.type && s.durationMs > 0 && (
                          <span className="session-row__duration-badge">
                            {Math.round(s.durationMs / 60000)}m
                          </span>
                        )}
                        <Text size="md" fw={700} truncate="end" title={sessionTitle}>
                          {sessionTitle}
                        </Text>
                      </div>

                      {(() => {
                        const participantIds = s.participants ? Object.keys(s.participants) : [];
                        const memoText = s.voiceMemos?.length > 0
                          ? s.voiceMemos.map(m => m.transcript).filter(Boolean).join(' \u2022 ')
                          : null;
                        const isSolo = participantIds.length === 1;
                        const timeStr = s.startTime
                          ? new Date(s.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', ...(s.timezone ? { timeZone: s.timezone } : {}) }).toLowerCase().replace(' ', '')
                          : null;

                        return (
                          <>
                            {!memoText && timeStr && (
                              <div className="session-row__meta">
                                <Text size="xs" c="dimmed" fw={500}>{timeStr}</Text>
                              </div>
                            )}

                            {participantIds.length > 0 && (
                              <div className={`session-row__participants${isSolo && memoText ? ' session-row__participants--with-memo' : ''}`}>
                                {Object.entries(s.participants).map(([id, p]) => (
                                  <span key={id} className="session-row__participant">
                                    <img
                                      src={`/api/v1/static/users/${id}`}
                                      alt={p.displayName}
                                      title={p.displayName}
                                      className="session-avatar"
                                      onError={(e) => { e.target.style.display = 'none'; }}
                                    />
                                  </span>
                                ))}
                                {s.totalRings > 0 && (
                                  <span className="session-row__rings"><RingIcon size={14} />{s.totalRings}</span>
                                )}
                                {s.maxSufferScore > 0 && (
                                  <span className="session-row__suffer"><StravaIcon size={14} />{s.maxSufferScore}</span>
                                )}
                              </div>
                            )}

                            {memoText && (
                              <div className="session-row__memo-line">
                                {timeStr && (
                                  <span className="session-row__memo-time">{timeStr}</span>
                                )}
                                <span className="session-row__memo-icon">{'\uD83C\uDF99'}</span>
                                <span className={`session-row__memo-text${isSolo ? ' session-row__memo-text--2line' : ''}`}>{memoText}</span>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>

                    {!bgUrl && s.strava && (s.strava.distance > 0 || s.strava.avgHeartrate) && (
                      <div className="session-row__strava-stats">
                        {s.strava.distance > 0 && (
                          <div className="session-row__stat">
                            <span className="session-row__stat-value">{(s.strava.distance / 1000).toFixed(1)}</span>
                            <span className="session-row__stat-label">km</span>
                          </div>
                        )}
                        {s.strava.avgHeartrate > 0 && (
                          <div className="session-row__stat">
                            <span className="session-row__stat-value">{Math.round(s.strava.avgHeartrate)}</span>
                            <span className="session-row__stat-label">bpm</span>
                          </div>
                        )}
                        {s.strava.elevation > 0 && (
                          <div className="session-row__stat">
                            <span className="session-row__stat-value">{Math.round(s.strava.elevation)}</span>
                            <span className="session-row__stat-label">m</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </Stack>
    </DashboardCard>
  );
}

// ─── Widget (screen-framework connector) ──────────────────

export default function FitnessSessionsWidget() {
  const rawSessions = useScreenData('sessions');
  const { replace, restore, getNode } = useScreen();
  const { scrollToDate, setScrollToDate, selectedSessionId, setSelectedSessionId } = useFitnessScreen();
  const navigate = useNavigate();
  const location = useLocation();
  // The detail pane currently open: { sessionId, revert, committed }. Tracks
  // WHICH session is shown so an outside selection change swaps the pane rather
  // than leaving the previous session's detail up. `committed` flips once the
  // replacement is visible in the layout, so a pane that later disappears can be
  // told apart from one that has not rendered yet.
  const openRef = useRef(null);
  const containerRef = useRef(null);

  const loading = rawSessions === null;
  const sessions = useMemo(() => rawSessions?.sessions || [], [rawSessions]);

  // Reflect the open session in the URL so it is deep-linkable / shareable:
  // /fitness/{screen}/session-{id}. Passing null returns to the bare screen path.
  const syncSessionUrl = useCallback((sessionId) => {
    const base = location.pathname.replace(/\/session-[^/]+$/, '');
    navigate(sessionId ? `${base}/session-${sessionId}` : base);
  }, [location.pathname, navigate]);

  const openDetail = useCallback((sessionId) => {
    openRef.current?.revert();
    openRef.current = { sessionId, committed: false, ...replace(SESSION_DETAIL_NODE_ID, sessionDetailSubtree(sessionId)) };
  }, [replace]);

  const handleSessionClick = useCallback((sessionId) => {
    if (selectedSessionId === sessionId) {
      openRef.current?.revert();
      openRef.current = null;
      setSelectedSessionId(null);
      syncSessionUrl(null);
      return;
    }
    setSelectedSessionId(sessionId);
    syncSessionUrl(sessionId);
    openDetail(sessionId);
  }, [selectedSessionId, setSelectedSessionId, syncSessionUrl, openDetail]);

  // A selection made outside this widget (post-session redirect, /session-{id}
  // deep link) opens its detail. When the screen mounted with the pane already
  // seeded for this session (ScreenProvider initialReplacements), adopt it rather
  // than pushing a duplicate. No wait on the sessions list: the detail widget
  // fetches its own session, and the selected row scrolls itself into view.
  useEffect(() => {
    if (!selectedSessionId) return;
    if (openRef.current?.sessionId === selectedSessionId) return;
    if (!openRef.current && openSessionIdOf(getNode(SESSION_DETAIL_NODE_ID)) === selectedSessionId) {
      openRef.current = { sessionId: selectedSessionId, committed: true, revert: () => restore(SESSION_DETAIL_NODE_ID) };
      return;
    }
    openDetail(selectedSessionId);
    // getNode changes identity on every replacement; only a selection change should re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionId, openDetail, restore]);

  // The detail pane closes itself (its × / back buttons call restore()). When the
  // pane this widget opened is gone, drop the selection and the /session-{id} URL
  // too — otherwise the row stays highlighted and a reload reopens the session.
  useEffect(() => {
    const open = openRef.current;
    if (!open) return;
    if (openSessionIdOf(getNode(SESSION_DETAIL_NODE_ID)) === open.sessionId) {
      open.committed = true;
      return;
    }
    if (!open.committed) return;
    openRef.current = null;
    setSelectedSessionId(null);
    syncSessionUrl(null);
  }, [getNode, setSelectedSessionId, syncSessionUrl]);

  // When calendar sets scrollToDate, scroll to that date group and auto-select first session
  useEffect(() => {
    if (!scrollToDate || !containerRef.current) return;
    const dateEl = containerRef.current.querySelector(`[data-date="${scrollToDate}"]`);
    if (dateEl) {
      dateEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    // Find first session for that date (sessions are reversed in display, so last in API = first visible)
    const dateSessions = sessions.filter(s => s.date === scrollToDate);
    if (dateSessions.length > 0) {
      handleSessionClick(dateSessions[dateSessions.length - 1].sessionId);
    }
    setScrollToDate(null);
  }, [scrollToDate, sessions, handleSessionClick, setScrollToDate]);

  return (
    <div ref={containerRef}>
      <SessionsCard
        sessions={sessions}
        loading={loading}
        onSessionClick={handleSessionClick}
        selectedSessionId={selectedSessionId}
      />
    </div>
  );
}
