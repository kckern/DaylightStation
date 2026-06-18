import React, { useMemo } from 'react';
import { WMO_ICONS, WMO_DESC, cToF, plural, buildTimeline } from './dayData.js';

export default function DayDataPoints({ day }) {
  const timeline = useMemo(() => (day ? buildTimeline(day) : []), [day]);
  const allPeople = useMemo(() => {
    const set = new Set();
    for (const photo of (day?.photos || [])) for (const p of (photo.people || [])) set.add(p);
    return [...set];
  }, [day]);

  if (!day) return null;

  const weather = day.weather;
  const videoCount = day.photos?.filter(p => p.type === 'video').length || 0;
  const imageCount = (day.photoCount || 0) - videoCount;
  const hasAny = !!weather || timeline.length > 0 || allPeople.length > 0 || (day.photoCount || 0) > 0;

  if (!hasAny) {
    return <div className="context-section day-data-quiet">Quiet day — nothing recorded.</div>;
  }

  return (
    <>
      {weather && (
        <div className="context-section">
          <h3 className="context-section-title">Weather</h3>
          <div className="context-weather">
            <span className="weather-icon-lg">{WMO_ICONS[weather.code] || '🌡'}</span>
            <span className="weather-temps">{cToF(weather.high)}° / {cToF(weather.low)}°</span>
            <span className="weather-desc">{WMO_DESC[weather.code] || ''}</span>
            {weather.precip > 0 && <span className="weather-detail">Precip: {weather.precip.toFixed(1)}mm</span>}
          </div>
        </div>
      )}
      {timeline.length > 0 && (
        <div className="context-section">
          <h3 className="context-section-title">Timeline</h3>
          <div className="context-timeline">
            {timeline.map((item, i) => (
              <div key={i} className={`timeline-item timeline-item--${item.type}`}>
                <span className="timeline-time">{item.time}{item.endTime ? ` – ${item.endTime}` : ''}</span>
                <span className="timeline-label">{item.label}</span>
                {item.participants && Object.keys(item.participants).length > 0 && (
                  <span className="timeline-people">{Object.values(item.participants).map(p => p.displayName).join(', ')}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {allPeople.length > 0 && (
        <div className="context-section">
          <h3 className="context-section-title">People</h3>
          <div className="context-people">{allPeople.map(p => <span key={p} className="person-tag">{p}</span>)}</div>
        </div>
      )}
      <div className="context-section">
        <h3 className="context-section-title">Summary</h3>
        <div className="context-stats">
          {imageCount > 0 && <span className="stat">{plural(imageCount, 'photo')}</span>}
          {videoCount > 0 && <span className="stat">{plural(videoCount, 'video')}</span>}
          {(day.calendar?.length || 0) > 0 && <span className="stat">{plural(day.calendar.length, 'event')}</span>}
          {(day.fitness?.length || 0) > 0 && <span className="stat">{plural(day.fitness.length, 'workout')}</span>}
        </div>
      </div>
    </>
  );
}
