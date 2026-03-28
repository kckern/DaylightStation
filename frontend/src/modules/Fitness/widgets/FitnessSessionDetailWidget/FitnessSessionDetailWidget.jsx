import React, { useState, useEffect, useMemo, useRef, useLayoutEffect, useCallback } from 'react';
import { Text, Skeleton } from '@mantine/core';
import { getWidgetRegistry } from '@/screen-framework/widgets/registry.js';
import { useScreen } from '@/screen-framework/providers/ScreenProvider.jsx';
import { useFitnessScreen } from '@/modules/Fitness/FitnessScreenProvider.jsx';
import FitnessTimeline from './FitnessTimeline.jsx';
import SportIcon from '../_shared/SportIcon.jsx';
import RouteMap from './RouteMap.jsx';
import './FitnessSessionDetailWidget.scss';

const CoinIcon = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
    <circle cx="8" cy="8" r="7" fill="#f5c542" stroke="#c9a020" strokeWidth="1" />
    <circle cx="8" cy="8" r="5" fill="none" stroke="#c9a020" strokeWidth="0.5" opacity="0.5" />
    <text x="8" y="11.5" textAnchor="middle" fontSize="9" fontWeight="700" fill="#8a6d10" fontFamily="sans-serif">$</text>
  </svg>
);

const StravaIcon = ({ size = 12, color = '#fc4c02' }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill={color} style={{ flexShrink: 0 }}>
    <path d="M6.731 0 2 9.125h2.788L6.73 5.497l1.93 3.628h2.766zm4.694 9.125-1.372 2.756L8.66 9.125H6.547L10.053 16l3.484-6.875z" />
  </svg>
);

function mediaDisplayUrl(contentId) {
  if (!contentId) return null;
  const str = String(contentId);
  if (str.includes(':')) {
    const [source, id] = str.split(':', 2);
    return `/api/v1/display/${source}/${id}`;
  }
  return `/api/v1/display/plex/${str}`;
}

function formatTime(startTime, timezone) {
  if (!startTime) return '--';
  const opts = { hour: 'numeric', minute: '2-digit' };
  if (timezone) opts.timeZone = timezone;
  return new Date(startTime).toLocaleTimeString([], opts).toLowerCase().replace(' ', '');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const { restore } = useScreen();
  const { onNavigate } = useFitnessScreen() || {};
  const posterRef = useRef(null);
  const [posterWidth, setPosterWidth] = useState(0);

  const handleDelete = useCallback(async () => {
    if (!sessionId || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/fitness/sessions/${sessionId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`${res.status}`);
      restore('right-area');
    } catch (err) {
      setDeleting(false);
      setError(`Delete failed: ${err.message}`);
    }
  }, [sessionId, deleting, restore]);

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
    if (!sessionId) return;
    setLoading(true);
    setError(null);

    fetch(`/api/v1/fitness/sessions/${sessionId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json();
      })
      .then((data) => {
        setSessionData(data.session || data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [sessionId]);

  const header = useMemo(() => {
    if (!sessionData) return null;
    const summary = sessionData.summary || {};
    const pm = Array.isArray(summary.media) ? summary.media.find(m => m.primary) || summary.media[0] : null;
    const session = sessionData.session || {};

    const dateStr = sessionData.sessionId
      ? `${sessionData.sessionId.slice(0, 4)}-${sessionData.sessionId.slice(4, 6)}-${sessionData.sessionId.slice(6, 8)}`
      : null;

    const durationMs = (session.duration_seconds || 0) * 1000;

    // Extract max suffer score and first activityId across all participants
    const participants = sessionData.participants || {};
    let sufferScore = null;
    let stravaActivityId = null;
    for (const p of Object.values(participants)) {
      const ss = p.strava?.sufferScore;
      if (ss != null && (sufferScore === null || ss > sufferScore)) {
        sufferScore = ss;
        stravaActivityId = p.strava?.activityId || null;
      }
    }

    const stravaBlock = sessionData.strava || null;

    return {
      title: pm?.title || stravaBlock?.name || 'Workout',
      showTitle: pm?.showTitle || pm?.grandparentTitle || null,
      grandparentId: pm?.grandparentId || null,
      posterUrl: pm?.grandparentId ? mediaDisplayUrl(pm.grandparentId) : null,
      thumbUrl: pm?.contentId ? mediaDisplayUrl(pm.contentId) : null,
      description: pm?.description || null,
      date: dateStr ? formatDate(dateStr) : '',
      time: session.start ? formatTime(new Date(session.start).getTime(), sessionData.timezone) : '--',
      durationMin: durationMs > 0 ? Math.round(durationMs / 60000) : null,
      totalCoins: sessionData.treasureBox?.totalCoins || summary.coins?.total || 0,
      sufferScore,
      stravaActivityId,
      voiceMemos: Array.isArray(summary.voiceMemos) ? summary.voiceMemos.filter(m => m.transcript) : [],
      stravaNotes: sessionData.strava_notes?.text || sessionData.stravaNotes || null,
      stravaType: stravaBlock?.type || null,
      stravaHasMap: !!(stravaBlock?.map?.polyline),
    };
  }, [sessionData]);

  if (loading) {
    return (
      <div className="session-detail" style={{ padding: '2rem', gap: '1rem' }}>
        <Skeleton height={20} width="40%" />
        <Skeleton height="100%" style={{ flex: 1 }} />
      </div>
    );
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

  return (
    <div className="session-detail">
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
        ) : (
          <div ref={posterRef} className="session-detail__poster session-detail__poster--placeholder">
            <SportIcon
              type={header?.stravaType}
              sessionId={sessionId}
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
              {header?.date && <span className="session-detail__meta-item">{header.date}</span>}
              <span className="session-detail__meta-sep" />
              {header?.time && <span className="session-detail__meta-item">{header.time}</span>}
              <span className="session-detail__meta-sep" />
              {header?.durationMin && <span className="session-detail__meta-item">{header.durationMin}m</span>}
              {header?.totalCoins > 0 && (
                <>
                  <span className="session-detail__meta-sep" />
                  <span className="session-detail__meta-item session-detail__coins"><CoinIcon size={14} /> {header.totalCoins}</span>
                </>
              )}
              {header?.sufferScore != null && (
                <>
                  <span className="session-detail__meta-sep" />
                  {header.stravaActivityId ? (
                    <a
                      href={`https://www.strava.com/activities/${header.stravaActivityId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="session-detail__meta-item session-detail__suffer"
                    ><StravaIcon size={14} /> {header.sufferScore}</a>
                  ) : (
                    <span className="session-detail__meta-item session-detail__suffer"><StravaIcon size={14} /> {header.sufferScore}</span>
                  )}
                </>
              )}
            </div>
            {(header?.voiceMemos?.length > 0 || header?.stravaNotes) && (
              <div className="session-detail__memos">
                {header.voiceMemos?.map((memo, i) => (
                  <div key={`memo-${i}`} className="session-detail__memo">
                    <span className="session-detail__memo-icon">{'\uD83C\uDF99'}</span>
                    <span className="session-detail__memo-text">{memo.transcript}</span>
                  </div>
                ))}
                {header.stravaNotes && (
                  <div className="session-detail__memo">
                    <span className="session-detail__memo-icon">{'\uD83D\uDCDD'}</span>
                    <span className="session-detail__memo-text">{header.stravaNotes}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {header?.thumbUrl ? (
          <div className="session-detail__thumb">
            <img
              src={header.thumbUrl}
              alt=""
              onError={(e) => { e.target.style.display = 'none'; }}
            />
            <button
              className="session-detail__close"
              onClick={() => restore('right-area')}
              title="Close"
            >&times;</button>
            <button
              className="session-detail__delete"
              onClick={handleDelete}
              disabled={deleting}
              title="Delete session"
            >{deleting ? '...' : '\u2715'}</button>
            {sessionId && (
              <code
                className="session-detail__session-id"
                onClick={() => navigator.clipboard?.writeText(sessionId)}
                title="Click to copy session ID"
              >{sessionId}</code>
            )}
            {header?.description && (
              <div className="session-detail__thumb-desc">
                <span>{header.description}</span>
              </div>
            )}
          </div>
        ) : sessionData?.strava ? (
          <div className="session-detail__thumb session-detail__thumb--strava-stats">
            <button className="session-detail__close" onClick={() => restore('right-area')} title="Close">&times;</button>
            <button className="session-detail__delete" onClick={handleDelete} disabled={deleting} title="Delete session">{deleting ? '...' : '\u2715'}</button>
            <div className="session-detail__strava-stats">
              {sessionData.strava.distance > 0 && (
                <div className="session-detail__stat">
                  <span className="session-detail__stat-value">{(sessionData.strava.distance / 1000).toFixed(1)}</span>
                  <span className="session-detail__stat-label">km</span>
                </div>
              )}
              {sessionData.strava.movingTime > 0 && (
                <div className="session-detail__stat">
                  <span className="session-detail__stat-value">{Math.round(sessionData.strava.movingTime / 60)}</span>
                  <span className="session-detail__stat-label">min</span>
                </div>
              )}
              {sessionData.strava.avgHeartrate && (
                <div className="session-detail__stat">
                  <span className="session-detail__stat-value">{Math.round(sessionData.strava.avgHeartrate)}</span>
                  <span className="session-detail__stat-label">avg HR</span>
                </div>
              )}
              {sessionData.strava.maxHeartrate && (
                <div className="session-detail__stat">
                  <span className="session-detail__stat-value">{Math.round(sessionData.strava.maxHeartrate)}</span>
                  <span className="session-detail__stat-label">max HR</span>
                </div>
              )}
              {sessionData.strava.totalElevationGain > 0 && (
                <div className="session-detail__stat">
                  <span className="session-detail__stat-value">{Math.round(sessionData.strava.totalElevationGain)}</span>
                  <span className="session-detail__stat-label">m elev</span>
                </div>
              )}
            </div>
            {sessionId && (
              <code className="session-detail__session-id" onClick={() => navigator.clipboard?.writeText(sessionId)} title="Click to copy session ID">{sessionId}</code>
            )}
          </div>
        ) : (
          <div className="session-detail__thumb session-detail__thumb--placeholder">
            <button className="session-detail__close" onClick={() => restore('right-area')} title="Close">&times;</button>
            <button className="session-detail__delete" onClick={handleDelete} disabled={deleting} title="Delete session">{deleting ? '...' : '\u2715'}</button>
          </div>
        )}
      </div>

      {/* Chart (40%) */}
      <div className="session-detail__chart">
        {header?.stravaHasMap ? (
          <RouteMap
            polyline={sessionData.strava?.map?.polyline}
            sessionId={sessionId}
            distance={sessionData.strava?.distance}
            elevation={sessionData.strava?.totalElevationGain}
          />
        ) : ChartComponent ? (
          <ChartComponent sessionData={sessionData} mode="standalone" />
        ) : (
          <Text c="dimmed" ta="center" py="xl">Chart not available</Text>
        )}
      </div>

      {/* Timeline (35%) */}
      <div className="session-detail__timeline">
        <FitnessTimeline sessionData={sessionData} maxAvatarSize={posterWidth} />
      </div>
    </div>
  );
}
