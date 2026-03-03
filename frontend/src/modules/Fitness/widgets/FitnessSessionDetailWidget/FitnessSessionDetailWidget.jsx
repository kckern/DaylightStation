import React, { useState, useEffect, useMemo, useRef, useLayoutEffect, useCallback } from 'react';
import { Text, Skeleton } from '@mantine/core';
import { getWidgetRegistry } from '@/screen-framework/widgets/registry.js';
import { useScreen } from '@/screen-framework/providers/ScreenProvider.jsx';
import FitnessTimeline from './FitnessTimeline.jsx';
import './FitnessSessionDetailWidget.scss';

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
  const { restore } = useScreen();
  const posterRef = useRef(null);
  const [posterWidth, setPosterWidth] = useState(0);

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

    // Extract max suffer score across all participants
    const participants = sessionData.participants || {};
    let sufferScore = null;
    for (const p of Object.values(participants)) {
      const ss = p.strava?.sufferScore;
      if (ss != null && (sufferScore === null || ss > sufferScore)) sufferScore = ss;
    }

    return {
      title: pm?.title || 'Workout',
      showTitle: pm?.showTitle || pm?.grandparentTitle || null,
      posterUrl: pm?.grandparentId ? mediaDisplayUrl(pm.grandparentId) : null,
      thumbUrl: pm?.contentId ? mediaDisplayUrl(pm.contentId) : null,
      description: pm?.description || null,
      date: dateStr ? formatDate(dateStr) : '',
      time: session.start ? formatTime(new Date(session.start).getTime(), sessionData.timezone) : '--',
      durationMin: durationMs > 0 ? Math.round(durationMs / 60000) : null,
      totalCoins: sessionData.treasureBox?.totalCoins || summary.coins?.total || 0,
      sufferScore,
      voiceMemos: Array.isArray(summary.voiceMemos) ? summary.voiceMemos.filter(m => m.transcript) : [],
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
          <div ref={posterRef} className="session-detail__poster">
            <img
              src={header.posterUrl}
              alt=""
              onError={(e) => { e.target.style.display = 'none'; }}
            />
          </div>
        ) : (
          <div ref={posterRef} className="session-detail__poster session-detail__poster--placeholder" />
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
                  <span className="session-detail__meta-item session-detail__coins">+{header.totalCoins}</span>
                </>
              )}
              {header?.sufferScore != null && (
                <>
                  <span className="session-detail__meta-sep" />
                  <span className="session-detail__meta-item session-detail__suffer">{header.sufferScore}</span>
                </>
              )}
            </div>
            {header?.voiceMemos?.length > 0 && (
              <div className="session-detail__memos">
                {header.voiceMemos.map((memo, i) => (
                  <div key={i} className="session-detail__memo">
                    <span className="session-detail__memo-icon">{'\uD83C\uDF99'}</span>
                    <span className="session-detail__memo-text">{memo.transcript}</span>
                  </div>
                ))}
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
            {header?.description && (
              <div className="session-detail__thumb-desc">
                <span>{header.description}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="session-detail__thumb session-detail__thumb--placeholder" />
        )}
      </div>

      {/* Chart (40%) */}
      <div className="session-detail__chart">
        {ChartComponent ? (
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
