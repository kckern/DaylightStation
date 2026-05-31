// frontend/src/modules/WeeklyReview/components/DayContextPanel.jsx
import React, { useMemo } from 'react';

const WMO_ICONS = {
  0: '☀️', 1: '🌤', 2: '⛅', 3: '☁️', 45: '🌫', 48: '🌫',
  51: '🌦', 53: '🌦', 55: '🌧', 61: '🌧', 63: '🌧', 65: '🌧',
  71: '🌨', 73: '🌨', 75: '❄️', 77: '❄️', 80: '🌦', 81: '🌧', 82: '🌧',
  85: '🌨', 86: '❄️', 95: '⛈', 96: '⛈', 99: '⛈',
};
const WMO_DESC = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Foggy', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Light showers', 81: 'Showers', 82: 'Heavy showers',
  85: 'Light snow showers', 86: 'Snow showers', 95: 'Thunderstorm', 96: 'Hail storm', 99: 'Heavy hail',
};
function cToF(c) { return Math.round(c * 9 / 5 + 32); }
function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

function buildTimeline(day) {
  const items = [];
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
  for (const event of (day.calendar || [])) {
    items.push({ type: 'calendar', time: event.allDay ? 'All day' : event.time, endTime: event.endTime, label: event.summary, sortKey: to24h(event.time) || (event.allDay ? '00:00' : '99:99') });
  }
  for (const session of (day.fitness || [])) {
    let timeStr = ''; let sortKey = '99:99';
    if (session.sessionId && session.sessionId.length >= 12) {
      const hh = parseInt(session.sessionId.slice(8, 10), 10);
      const mm = session.sessionId.slice(10, 12);
      const ampm = hh >= 12 ? 'PM' : 'AM';
      const h12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
      timeStr = `${h12}:${mm} ${ampm}`; sortKey = `${String(hh).padStart(2, '0')}:${mm}`;
    }
    const durationMin = session.durationMs ? Math.round(session.durationMs / 60000) : null;
    const title = session.media?.primary?.showTitle || session.media?.primary?.title || 'Workout';
    items.push({ type: 'fitness', time: timeStr, label: `${title}${durationMin ? ` (${durationMin} min)` : ''}`, sortKey, participants: session.participants });
  }
  for (const session of (day.sessions || [])) {
    items.push({ type: 'photo', time: session.timeRange || '', label: plural(session.count, 'photo'), sortKey: to24h(session.timeRange?.split(' – ')[0]) || '99:99' });
  }
  items.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  return items;
}

export default function DayContextPanel({ day, open }) {
  // Hooks must run unconditionally — compute before any early return.
  const timeline = useMemo(() => (day ? buildTimeline(day) : []), [day]);
  const allPeople = useMemo(() => {
    const set = new Set();
    for (const photo of (day?.photos || [])) for (const p of (photo.people || [])) set.add(p);
    return [...set];
  }, [day]);

  if (!open || !day) return null;

  const weather = day.weather;
  const videoCount = day.photos?.filter(p => p.type === 'video').length || 0;
  const imageCount = (day.photoCount || 0) - videoCount;

  return (
    <div className="weekly-review-context-panel" role="dialog" aria-modal="true" aria-label="Day details">
      <div className="context-panel-inner">
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
      </div>
    </div>
  );
}
