import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { createMediaTransportAdapter } from '@/lib/Player/mediaTransportAdapter.js';
import getLogger from '@/lib/logging/Logger.js';

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

  // Calendar events
  for (const event of (day.calendar || [])) {
    const sortKey = event.time || (event.allDay ? '00:00' : '99:99');
    items.push({
      type: 'calendar',
      time: event.allDay ? 'All day' : event.time,
      endTime: event.endTime,
      label: event.summary,
      sortKey,
    });
  }

  // Fitness sessions
  for (const session of (day.fitness || [])) {
    const startMs = session.startTime;
    let timeStr = '';
    if (startMs) {
      const d = new Date(typeof startMs === 'number' ? startMs : startMs);
      timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
    const durationMin = session.durationMs ? Math.round(session.durationMs / 60000) : null;
    const title = session.media?.primary?.showTitle || session.media?.primary?.title || 'Workout';
    items.push({
      type: 'fitness',
      time: timeStr,
      label: `${title}${durationMin ? ` (${durationMin} min)` : ''}`,
      sortKey: timeStr || '99:99',
    });
  }

  // Photo sessions
  for (const session of (day.sessions || [])) {
    items.push({
      type: 'photo',
      time: session.timeRange || '',
      label: plural(session.count, 'photo'),
      sortKey: session.timeRange?.split(' – ')[0] || '99:99',
    });
  }

  // Sort by time
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
                    </div>
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
            <div className="day-detail-photos">
              {day.photos.map(photo => {
                const timeLabel = photo.takenAt
                  ? new Date(photo.takenAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                  : null;
                return (
                  <div
                    key={photo.id}
                    className={`day-detail-photo${photo.type === 'video' ? ' day-detail-photo--video' : ''}`}
                    onClick={() => handleMediaClick(photo)}
                  >
                    <img src={photo.thumbnail} alt="" loading="lazy" />
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
