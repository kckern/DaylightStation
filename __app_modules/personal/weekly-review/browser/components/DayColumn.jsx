import React from 'react';
import PhotoWall from "./PhotoWall.jsx";
import { WMO_ICONS, cToF } from "./dayData.js";
import LearnerAvatar from "./LearnerAvatar.jsx";
import { subjectGlyph, verbLabel, kidStyle } from "./schoolWork.js";
import getLogger from '@/lib/logging/Logger.js';

let _l;
const logger = () => (_l ||= getLogger().child({ component: 'weekly-review-grid' }));

const MAX_CHIPS = 5;

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
      <LearnerAvatar learnerId={item.learnerId} name={name} className="school-chip-avatar" size={64} />
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
  const school = day.school || [];
  // One row: past the cap, the last slot becomes "+N".
  const shownSchool = school.length > MAX_CHIPS ? school.slice(0, MAX_CHIPS - 1) : school;
  const schoolOverflow = school.length - shownSchool.length;

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

      {/* Photos are the day: they take the cell. Calendar events and workouts
          are not drawn here (truncated chips told nothing); they are in the
          Down details panel, where there is room to read them. */}
      <div className={`day-photos${day.photoCount > 0 ? '' : ' day-photos--none'}`}>
        {day.photoCount > 0 ? (
          <PhotoWall photos={day.photos} />
        ) : !weather && (
          <div className="day-empty-content">
            <span className="day-empty-name">{dayName}</span>
          </div>
        )}
      </div>

      {/* School work: one small row under the photos, each child's face on
          their piece. Its full presence is in the day reel and the showcase. */}
      {day.school?.length > 0 && (
        <div className="day-school">
          {shownSchool.map(item => (
            <SchoolChip
              key={`${item.learnerId}:${item.groupKey}:${item.studyDay}`}
              item={item}
              color={learnerColors?.[item.learnerId]}
            />
          ))}
          {schoolOverflow > 0 && <span className="school-chip school-chip--overflow">+{schoolOverflow}</span>}
        </div>
      )}
    </div>
  );
}
