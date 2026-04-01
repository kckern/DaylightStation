import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { createMediaTransportAdapter } from '@/lib/Player/mediaTransportAdapter.js';
import getLogger from '@/lib/logging/Logger.js';

/** Build a Plex thumbnail URL from a contentId like "plex:12345" */
function plexThumbUrl(contentId) {
  if (!contentId) return null;
  const match = contentId.match(/^plex:(\d+)$/);
  if (!match) return null;
  const plexId = match[1];
  return `/api/v1/proxy/plex/photo/:/transcode?width=120&height=120&minSize=1&upscale=1&url=/library/metadata/${plexId}/thumb/${Date.now()}`;
}

const logger = getLogger().child({ component: 'weekly-review-day-detail' });

const WMO_ICONS = {
  0: '☀️', 1: '🌤', 2: '⛅', 3: '☁️',
  45: '🌫', 48: '🌫',
  51: '🌦', 53: '🌦', 55: '🌧',
  61: '🌧', 63: '🌧', 65: '🌧',
  71: '🌨', 73: '🌨', 75: '❄️',
  77: '❄️', 80: '🌦', 81: '🌧', 82: '🌧',
  85: '🌨', 86: '❄️', 95: '⛈', 96: '⛈', 99: '⛈',
};

const WMO_DESC = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Foggy', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
  77: 'Snow grains', 80: 'Light showers', 81: 'Showers', 82: 'Heavy showers',
  85: 'Light snow showers', 86: 'Snow showers', 95: 'Thunderstorm', 96: 'Hail storm', 99: 'Heavy hail',
};

function cToF(c) { return Math.round(c * 9 / 5 + 32); }
function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

/** Parse local time from Immich's localDateTime (has Z but is actually local time) */
function parseLocalTime(isoStr) {
  if (!isoStr) return null;
  const match = isoStr.match(/T(\d{2}):(\d{2})/);
  if (!match) return null;
  let h = parseInt(match[1], 10);
  const m = match[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m} ${ampm}`;
}

function formatTime12(timeStr) {
  if (!timeStr) return '';
  return timeStr;
}

function MiniVideoPlayer({ src, onClose }) {
  const videoRef = useRef(null);
  const transport = useRef(null);

  useEffect(() => {
    transport.current = createMediaTransportAdapter({ mediaRef: videoRef });
    logger.info('video.player-open', { src });
    return () => logger.info('video.player-close');
  }, [src]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onPlay = () => logger.debug('video.play');
    const onPause = () => logger.debug('video.pause');
    const onEnded = () => logger.info('video.ended');
    const onError = () => logger.error('video.error', { error: el.error?.message || 'unknown' });
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    el.addEventListener('error', onError);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('error', onError);
    };
  }, []);

  return (
    <div className="mini-video-overlay" onClick={() => { logger.info('video.overlay-dismiss'); onClose(); }}>
      <div className="mini-video-container" onClick={e => e.stopPropagation()}>
        <video ref={videoRef} src={src} autoPlay controls playsInline className="mini-video-player" />
        <button className="mini-video-close" onClick={() => { logger.info('video.close-button'); onClose(); }}>✕</button>
      </div>
    </div>
  );
}

/**
 * Build a chronological timeline from calendar events, fitness sessions, and photo sessions
 */
function buildTimeline(day) {
  const items = [];

  /** Convert "H:MM AM/PM" to 24h "HH:MM" for sorting */
  function to24h(timeStr) {
    if (!timeStr || timeStr === 'All day') return '00:00';
    const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!match) return '99:99';
    let h = parseInt(match[1], 10);
    const m = match[2];
    const ampm = match[3].toUpperCase();
    if (ampm === 'PM' && h !== 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${m}`;
  }

  // Calendar events
  for (const event of (day.calendar || [])) {
    items.push({
      type: 'calendar',
      time: event.allDay ? 'All day' : event.time,
      endTime: event.endTime,
      label: event.summary,
      sortKey: to24h(event.time) || (event.allDay ? '00:00' : '99:99'),
    });
  }

  // Fitness sessions — extract time from sessionId (YYYYMMDDHHmmss)
  for (const session of (day.fitness || [])) {
    let timeStr = '';
    let sortKey = '99:99';
    if (session.sessionId && session.sessionId.length >= 12) {
      const hh = parseInt(session.sessionId.slice(8, 10), 10);
      const mm = session.sessionId.slice(10, 12);
      const ampm = hh >= 12 ? 'PM' : 'AM';
      const h12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
      timeStr = `${h12}:${mm} ${ampm}`;
      sortKey = `${String(hh).padStart(2, '0')}:${mm}`;
    }
    const durationMin = session.durationMs ? Math.round(session.durationMs / 60000) : null;
    const title = session.media?.primary?.showTitle || session.media?.primary?.title || 'Workout';
    items.push({
      type: 'fitness',
      time: timeStr,
      label: `${title}${durationMin ? ` (${durationMin} min)` : ''}`,
      sortKey,
      thumbnail: plexThumbUrl(session.media?.primary?.grandparentId) || plexThumbUrl(session.media?.primary?.contentId) || null,
      participants: session.participants,
    });
  }

  // Photo sessions — include first photo thumbnail
  for (const session of (day.sessions || [])) {
    // Find a photo from this session
    const sessionPhotos = (day.photos || []).filter(p => p.sessionIndex === session.index);
    items.push({
      type: 'photo',
      time: session.timeRange || '',
      label: plural(session.count, 'photo'),
      sortKey: to24h(session.timeRange?.split(' – ')[0]) || '99:99',
      thumbnail: sessionPhotos[0]?.thumbnail || null,
    });
  }

  items.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  return items;
}

export default function DayDetail({ day, isToday, onClose }) {
  const [activeVideo, setActiveVideo] = useState(null);

  const date = new Date(`${day.date}T12:00:00Z`);
  const fullDate = date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const hasPhotos = day.photos?.length > 0;
  const videoCount = day.photos?.filter(p => p.type === 'video').length || 0;
  const imageCount = (day.photoCount || 0) - videoCount;
  const weather = day.weather;
  const timeline = useMemo(() => buildTimeline(day), [day]);

  // Collect all people mentioned across all photos
  const allPeople = useMemo(() => {
    const set = new Set();
    for (const photo of (day.photos || [])) {
      for (const person of (photo.people || [])) {
        set.add(person);
      }
    }
    return [...set];
  }, [day.photos]);

  useEffect(() => {
    logger.info('day-detail.open', {
      date: day.date, isToday, imageCount, videoCount,
      calendarCount: day.calendar?.length || 0,
      fitnessCount: day.fitness?.length || 0,
    });
    return () => logger.info('day-detail.close', { date: day.date });
  }, [day.date]);

  const handleMediaClick = useCallback((photo) => {
    if (photo.type === 'video') {
      logger.info('media.video-click', { id: photo.id, date: day.date });
      setActiveVideo(photo.original);
    } else {
      logger.debug('media.image-click', { id: photo.id, date: day.date });
    }
  }, [day.date]);

  return (
    <div className={`day-detail${isToday ? ' day-detail--today' : ''}`}>
      <div className="day-detail-header">
        <h2 className="day-detail-title">{fullDate}</h2>
        {weather && (
          <div className="day-detail-weather-badge">
            <span className="weather-badge-icon">{WMO_ICONS[weather.code] || '🌡'}</span>
            <span className="weather-badge-temps">{cToF(weather.high)}° / {cToF(weather.low)}°</span>
          </div>
        )}
        <button className="day-detail-close" onClick={() => { logger.info('day-detail.close-button', { date: day.date }); onClose(); }}>✕</button>
      </div>

      <div className="day-detail-body">
        <div className="day-detail-sidebar">
          {/* Weather */}
          {weather && (
            <div className="day-detail-section">
              <h3 className="day-detail-section-title">Weather</h3>
              <div className="day-detail-weather">
                <div className="weather-main">
                  <span className="weather-icon-lg">{WMO_ICONS[weather.code] || '🌡'}</span>
                  <div className="weather-temps">
                    <div className="weather-high">{cToF(weather.high)}°F</div>
                    <div className="weather-low">{cToF(weather.low)}°F</div>
                  </div>
                </div>
                <div className="weather-desc">{WMO_DESC[weather.code] || ''}</div>
                {weather.precip > 0 && <div className="weather-detail">Precip: {weather.precip.toFixed(1)}mm</div>}
              </div>
            </div>
          )}

          {/* Timeline */}
          {timeline.length > 0 && (
            <div className="day-detail-section">
              <h3 className="day-detail-section-title">Timeline</h3>
              <div className="day-timeline">
                {timeline.map((item, i) => (
                  <div key={i} className={`timeline-item timeline-item--${item.type}`}>
                    <div className="timeline-dot" />
                    <div className="timeline-content">
                      <span className="timeline-time">{item.time}{item.endTime ? ` – ${item.endTime}` : ''}</span>
                      <span className="timeline-label">{item.label}</span>
                      {item.participants && Object.keys(item.participants).length > 0 && (
                        <span className="timeline-people">{Object.values(item.participants).map(p => p.displayName).join(', ')}</span>
                      )}
                    </div>
                    {item.thumbnail && (
                      <div className="timeline-thumb">
                        <img src={item.thumbnail} alt="" loading="lazy" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* People */}
          {allPeople.length > 0 && (
            <div className="day-detail-section">
              <h3 className="day-detail-section-title">People</h3>
              <div className="day-detail-people">
                {allPeople.map(person => (
                  <span key={person} className="person-tag">{person}</span>
                ))}
              </div>
            </div>
          )}

          {/* Summary */}
          <div className="day-detail-section">
            <h3 className="day-detail-section-title">Summary</h3>
            <div className="day-detail-stats">
              {imageCount > 0 && <div className="stat">{plural(imageCount, 'photo')}</div>}
              {videoCount > 0 && <div className="stat">{plural(videoCount, 'video')}</div>}
              {(day.calendar?.length || 0) > 0 && <div className="stat">{plural(day.calendar.length, 'event')}</div>}
              {(day.fitness?.length || 0) > 0 && <div className="stat">{plural(day.fitness.length, 'workout')}</div>}
            </div>
          </div>
        </div>

        {/* Photo/Video Gallery */}
        <div className="day-detail-gallery">
          {hasPhotos ? (
            <div className="day-detail-photos" data-count={Math.min(day.photos.length, 7)}>
              {day.photos.map(photo => {
                const timeLabel = parseLocalTime(photo.takenAt);
                return (
                  <div
                    key={photo.id}
                    className={`day-detail-photo${photo.type === 'video' ? ' day-detail-photo--video' : ''}`}
                    style={{ backgroundImage: `url(${photo.thumbnail})` }}
                    onClick={() => handleMediaClick(photo)}
                  >
                    <img src={photo.original} alt="" loading="lazy" />
                    {photo.type === 'video' && (
                      <div className="day-detail-video-play">▶</div>
                    )}
                    <div className="day-detail-photo-meta">
                      {timeLabel && <span className="photo-time">{timeLabel}</span>}
                      {photo.people?.length > 0 && <span className="photo-people">{photo.people.join(', ')}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="day-detail-no-photos">
              No photos for this day
            </div>
          )}
        </div>
      </div>

      {activeVideo && (
        <MiniVideoPlayer
          src={activeVideo}
          onClose={() => { logger.info('video.close', { date: day.date }); setActiveVideo(null); }}
        />
      )}
    </div>
  );
}
