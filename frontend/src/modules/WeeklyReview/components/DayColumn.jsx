import React from 'react';
import PhotoWall from './PhotoWall.jsx';

const WMO_ICONS = {
  0: '☀️', 1: '🌤', 2: '⛅', 3: '☁️',
  45: '🌫', 48: '🌫',
  51: '🌦', 53: '🌦', 55: '🌧',
  61: '🌧', 63: '🌧', 65: '🌧',
  71: '🌨', 73: '🌨', 75: '❄️',
  77: '❄️', 80: '🌦', 81: '🌧', 82: '🌧',
  85: '🌨', 86: '❄️', 95: '⛈', 96: '⛈', 99: '⛈',
};

function cToF(c) {
  return Math.round(c * 9 / 5 + 32);
}

export default function DayColumn({ day, isFocused, isToday, onClick }) {
  const dateNum = new Date(`${day.date}T12:00:00Z`).getDate();
  const dayName = new Date(`${day.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long' });
  const hasContent = day.photoCount > 0 || day.fitness?.length > 0;
  const columnClass = [
    'day-column',
    isFocused && 'day-column--focused',
    isToday && 'day-column--today',
    !hasContent && 'day-column--empty',
  ].filter(Boolean).join(' ');

  const weather = day.weather;

  return (
    <div
      className={columnClass}
      style={{ flex: day.columnWeight }}
      onClick={onClick}
    >
      <div className="day-header">
        <span className="day-label">{day.label}</span>
        <span className="day-date">{dateNum}</span>
        {weather && (
          <span className="day-weather">
            <span className="weather-icon">{WMO_ICONS[weather.code] || '🌡'}</span>
            <span className="weather-temp">{cToF(weather.high)}°/{cToF(weather.low)}°</span>
          </span>
        )}
      </div>

      {day.calendar.length > 0 && (
        <div className="day-calendar">
          {day.calendar.map((event, i) => (
            <div key={i} className="calendar-chip">
              {event.time && <span className="chip-time">{event.time}</span>}
              {event.summary}
            </div>
          ))}
        </div>
      )}

      {day.fitness?.length > 0 && (
        <div className="day-fitness">
          {day.fitness.map((session, i) => (
            <div key={i} className="fitness-chip">
              <span className="fitness-icon">🏋️</span>
              {session.media?.primary?.showTitle || session.media?.primary?.title || 'Workout'}
              {Object.keys(session.participants || {}).length > 1 && (
                <span className="fitness-people"> · {Object.values(session.participants).map(p => p.displayName).join(', ')}</span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="day-photos">
        {day.photoCount > 0 ? (
          <PhotoWall photos={day.photos} />
        ) : weather ? (
          <div className="day-empty-content day-empty-weather">
            <span className="weather-big-icon">{WMO_ICONS[weather.code] || '🌡'}</span>
            <span className="weather-big-temp">{cToF(weather.high)}° / {cToF(weather.low)}°</span>
          </div>
        ) : (
          <div className="day-empty-content">
            <span className="day-empty-name">{dayName}</span>
          </div>
        )}
      </div>
    </div>
  );
}
