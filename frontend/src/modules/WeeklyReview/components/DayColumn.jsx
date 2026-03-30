import React from 'react';
import PhotoWall from './PhotoWall.jsx';

export default function DayColumn({ day, isFocused, isToday, onClick }) {
  const dateNum = new Date(`${day.date}T12:00:00Z`).getDate();
  const dayName = new Date(`${day.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long' });
  const columnClass = [
    'day-column',
    isFocused && 'day-column--focused',
    isToday && 'day-column--today',
    day.photoCount === 0 && 'day-column--empty',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={columnClass}
      style={{ flex: day.columnWeight }}
      onClick={onClick}
    >
      <div className="day-header">
        <span className="day-label">{day.label}</span>
        <span className="day-date">{dateNum}</span>
      </div>

      {day.calendar.length > 0 && (
        <div className="day-calendar">
          {day.calendar.map((event, i) => (
            <div key={i} className="calendar-chip">
              {event.summary}
            </div>
          ))}
        </div>
      )}

      <div className="day-photos">
        {day.photoCount > 0 ? (
          <PhotoWall photos={day.photos} />
        ) : (
          <div className="day-empty-content">
            <span className="day-empty-name">{dayName}</span>
          </div>
        )}
      </div>
    </div>
  );
}
