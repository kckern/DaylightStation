// frontend/src/modules/Media/cast/reportedSpot.js
// A screen's current spot from its last report: the published position,
// carried forward by the time since it was heard while it plays (at its
// playback rate), never past the item's end. Used to line screens up
// (PLACE.4a/AC5) and to move one screen's playback to another (PLACE.9a).
export function reportedSpot(snapshot, receivedAt, now = Date.now()) {
  if (!snapshot || !Number.isFinite(snapshot.position)) return null;
  if (snapshot.state !== 'playing') return snapshot.position;
  const heard = Date.parse(receivedAt ?? '');
  const elapsed = Number.isFinite(heard) ? Math.max(0, (now - heard) / 1000) : 0;
  const rate = Number(snapshot.config?.playbackRate) > 0 ? Number(snapshot.config.playbackRate) : 1;
  const spot = snapshot.position + elapsed * rate;
  const duration = snapshot.currentItem?.duration;
  return Number.isFinite(duration) && duration > 0 ? Math.min(spot, duration) : spot;
}

export default reportedSpot;
