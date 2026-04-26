import React from 'react';

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
      <div className="fullscreen-image-overlay">
        <div className="fullscreen-image-day">{dayLabel}</div>
        <div className="fullscreen-image-index">{index + 1} / {total}</div>
        {photo.people?.length > 0 && (
          <div className="fullscreen-image-people">{photo.people.join(', ')}</div>
        )}
      </div>
    </div>
  );
}
