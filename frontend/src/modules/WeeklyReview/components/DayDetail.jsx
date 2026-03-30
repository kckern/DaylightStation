import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createMediaTransportAdapter } from '@/lib/Player/mediaTransportAdapter.js';

const formatTime = (time) => {
  if (!time) return '';
  return time;
};

function MiniVideoPlayer({ src, onClose }) {
  const videoRef = useRef(null);
  const transport = useRef(null);

  useEffect(() => {
    transport.current = createMediaTransportAdapter({ mediaRef: videoRef });
  }, []);

  const handleToggle = useCallback(() => {
    transport.current?.toggle();
  }, []);

  return (
    <div className="mini-video-overlay" onClick={onClose}>
      <div className="mini-video-container" onClick={e => e.stopPropagation()}>
        <video
          ref={videoRef}
          src={src}
          autoPlay
          controls
          playsInline
          className="mini-video-player"
        />
        <button className="mini-video-close" onClick={onClose}>✕</button>
      </div>
    </div>
  );
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
  const hasCalendar = day.calendar?.length > 0;
  const hasSessions = day.sessions?.length > 0;

  const handleMediaClick = useCallback((photo) => {
    if (photo.type === 'video') {
      setActiveVideo(photo.original);
    }
  }, []);

  return (
    <div className={`day-detail${isToday ? ' day-detail--today' : ''}`}>
      {/* Header */}
      <div className="day-detail-header">
        <h2 className="day-detail-title">{fullDate}</h2>
        <button className="day-detail-close" onClick={onClose}>✕</button>
      </div>

      <div className="day-detail-body">
        {/* Calendar Events */}
        <div className="day-detail-sidebar">
          <div className="day-detail-section">
            <h3 className="day-detail-section-title">Calendar</h3>
            {hasCalendar ? (
              <div className="day-detail-events">
                {day.calendar.map((event, i) => (
                  <div key={i} className="day-detail-event">
                    <div className="event-summary">{event.summary}</div>
                    {event.time && (
                      <div className="event-time">
                        {formatTime(event.time)}
                        {event.endTime && ` – ${formatTime(event.endTime)}`}
                      </div>
                    )}
                    {event.allDay && <div className="event-time">All day</div>}
                    {event.calendar && (
                      <div className="event-calendar">{event.calendar}</div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="day-detail-empty">No events</div>
            )}
          </div>

          {hasSessions && (
            <div className="day-detail-section">
              <h3 className="day-detail-section-title">Photo Sessions</h3>
              <div className="day-detail-sessions">
                {day.sessions.map((session, i) => (
                  <div key={i} className="day-detail-session">
                    <span className="session-count">{session.count} photos</span>
                    {session.timeRange && (
                      <span className="session-time">{session.timeRange}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="day-detail-section">
            <h3 className="day-detail-section-title">Summary</h3>
            <div className="day-detail-stats">
              <div className="stat">{day.photoCount} photos</div>
              <div className="stat">{day.calendar?.length || 0} events</div>
            </div>
          </div>
        </div>

        {/* Photo/Video Gallery */}
        <div className="day-detail-gallery">
          {hasPhotos ? (
            <div className="day-detail-photos">
              {day.photos.map(photo => (
                <div
                  key={photo.id}
                  className={`day-detail-photo${photo.type === 'video' ? ' day-detail-photo--video' : ''}`}
                  onClick={() => handleMediaClick(photo)}
                >
                  <img src={photo.thumbnail} alt="" loading="lazy" />
                  {photo.type === 'video' && (
                    <div className="day-detail-video-play">▶</div>
                  )}
                  {photo.people?.length > 0 && (
                    <div className="day-detail-photo-people">
                      {photo.people.join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="day-detail-no-photos">
              No photos for this day
            </div>
          )}
        </div>
      </div>

      {/* Video Player Overlay */}
      {activeVideo && (
        <MiniVideoPlayer
          src={activeVideo}
          onClose={() => setActiveVideo(null)}
        />
      )}
    </div>
  );
}
