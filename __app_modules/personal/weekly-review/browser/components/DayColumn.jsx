import React from 'react';
import PhotoWall from "./PhotoWall.jsx";
import { WMO_ICONS, cToF } from "./dayData.js";
import { subjectGlyph, verbLabel, kidStyle } from "./schoolWork.js";
import getLogger from '@/lib/logging/Logger.js';

let _l;
const logger = () => (_l ||= getLogger().child({ component: 'weekly-review-grid' }));

const MAX_CHIPS = 3;

function SchoolChip({ item, color }) {
  const [failed, setFailed] = React.useState(false);
  const showImage = !!item.imageUrl && !failed;
  const name = item.learnerName || '';
  return (
    <div
      className="school-chip"
      style={kidStyle(color)}
      title={`${name}: ${[verbLabel(item), item.title].filter(Boolean).join(' ')}`}
    >
      {showImage ? (
        <img
          className="school-chip-img"
          src={item.imageUrl}
          alt=""
          onError={() => {
            logger().warn('grid.school-chip-image-error', { imageUrl: item.imageUrl });
            setFailed(true);
          }}
        />
      ) : (
        <span className="school-chip-glyph" aria-hidden="true">{subjectGlyph(item.subject)}</span>
      )}
      <span className="school-chip-initial" aria-hidden="true">{name.charAt(0)}</span>
    </div>
  );
}

export default function DayColumn({ day, isFocused, onClick, learnerColors }) {
  const dt = new Date(`${day.date}T12:00:00Z`);
  const dateNum = dt.getDate();
  const monthAbbr = dt.toLocaleDateString('en-US', { month: 'short' });
  const dayName = dt.toLocaleDateString('en-US', { weekday: 'long' });
  const hasContent = day.photoCount > 0 || day.fitness?.length > 0 || day.calendar?.length > 0 || day.school?.length > 0;
  const columnClass = [
    'day-column',
    isFocused && 'day-column--focused',
    !hasContent && 'day-column--empty',
  ].filter(Boolean).join(' ');

  const weather = day.weather;
  // When a day has a photo grid, photos should dominate the cell. Collapse the
  // calendar/fitness chip stacks to a single horizontal row (fewer chips, the
  // rest folded into a "+N more" overflow) so they don't eat vertical space.
  const compact = day.photoCount > 0;
  const chipMax = compact ? 2 : MAX_CHIPS;

  return (
    <div
      className={columnClass}
      style={{ flex: day.columnWeight ?? 1 }}
      role="button"
      tabIndex={0}
      aria-label={[
        `${day.label} ${dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`,
        day.photoCount > 0 ? `${day.photoCount} photos` : null,
        day.calendar?.length ? `${day.calendar.length} event${day.calendar.length === 1 ? '' : 's'}` : null,
        day.fitness?.length ? `${day.fitness.length} workout${day.fitness.length === 1 ? '' : 's'}` : null,
        day.school?.length ? `${day.school.length} school item${day.school.length === 1 ? '' : 's'}` : null,
        weather ? `${cToF(weather.high)} degrees` : null,
      ].filter(Boolean).join(', ')}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="day-header">
        <span className="day-label">{day.label}</span>
        <span className="day-date">{dateNum}</span>
        <span className="day-month">{monthAbbr}</span>
        {weather && (
          <span className="day-weather">
            <span className="weather-icon">{WMO_ICONS[weather.code] || '🌡'}</span>
            <span className="weather-temp">{cToF(weather.high)}°/{cToF(weather.low)}°</span>
          </span>
        )}
      </div>

      {day.calendar.length > 0 && (
        <div className={`day-calendar${compact ? ' day-calendar--compact' : ''}`}>
          {day.calendar.slice(0, chipMax).map((event, i) => (
            <div key={i} className="calendar-chip">
              {event.time && <span className="chip-time">{event.time}</span>}
              {event.summary}
            </div>
          ))}
          {day.calendar.length > chipMax && (
            <div className="calendar-chip calendar-chip--overflow">+{day.calendar.length - chipMax} more</div>
          )}
        </div>
      )}

      {day.fitness?.length > 0 && (
        <div className={`day-fitness${compact ? ' day-fitness--compact' : ''}`}>
          {day.fitness.slice(0, chipMax).map((session, i) => (
            <div key={i} className="fitness-chip">
              <span className="fitness-icon">🏋️</span>
              {session.media?.primary?.showTitle || session.media?.primary?.title || 'Workout'}
              {Object.keys(session.participants || {}).length > 1 && (
                <span className="fitness-people"> · {Object.values(session.participants).map(p => p.displayName).join(', ')}</span>
              )}
            </div>
          ))}
          {day.fitness.length > chipMax && (
            <div className="fitness-chip fitness-chip--overflow">+{day.fitness.length - chipMax} more</div>
          )}
        </div>
      )}

      {day.school?.length > 0 && (
        <div className="day-school">
          {day.school.map(item => (
            <SchoolChip
              key={`${item.learnerId}:${item.groupKey}:${item.studyDay}`}
              item={item}
              color={learnerColors?.[item.learnerId]}
            />
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
