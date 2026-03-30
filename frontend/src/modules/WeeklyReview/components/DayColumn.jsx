import React from 'react';
import PhotoWall from './PhotoWall.jsx';

export default function DayColumn({ day, isFocused, isToday }) {
  const dateNum = new Date(`${day.date}T12:00:00Z`).getDate();
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
        <PhotoWall photos={day.photos} />
      </div>
    </div>
  );
}
