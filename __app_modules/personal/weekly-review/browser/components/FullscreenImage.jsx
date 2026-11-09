import React from 'react';

// Parse "h:mm AM/PM" from Immich's localDateTime string (e.g. "2026-06-22T14:25:13").
// Reads the local wall-clock fields directly — no timezone math.
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

/**
 * Single-image fullscreen view with index indicator.
 * Props:
 *   - photo: { id, original, thumbnail, takenAt, people, type } (one entry from day.photos)
 *   - index: number  (0-based)
 *   - total: number  (count of photos in the day)
 *   - dayLabel: string  (e.g., "Tuesday, April 22")
 */
export default function FullscreenImage({ photo, index, total, dayLabel }) {
  if (!photo) return null;
  return (
    <div className="weekly-review-fullscreen-image">
      <img className="fullscreen-image-img" src={photo.original} alt="" />
      <MediaCaption item={photo} index={index} total={total} dayLabel={dayLabel} />
    </div>
  );
}

/**
 * The bottom caption every reel item wears — day · time, position, people —
 * on a gradient flush to the screen's bottom and side edges. Shared by photos
 * and videos so the two read as one reel; `children` adds item-specific state
 * (a video's mute hint) at the trailing end.
 */
export function MediaCaption({ item, index, total, dayLabel, children }) {
  const time = parseLocalTime(item.takenAt);
  return (
    <div className="fullscreen-image-overlay">
      <div className="fullscreen-image-day">
        {dayLabel}
        {time && <span className="fullscreen-image-time"> · {time}</span>}
      </div>
      <div className="fullscreen-image-index">{index + 1} / {total}</div>
      {item.people?.length > 0 && (
        <div className="fullscreen-image-people">{item.people.join(', ')}</div>
      )}
      {children}
    </div>
  );
}
