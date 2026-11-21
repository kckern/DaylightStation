/** Format the Feed player's normalized volume value for control announcements. */
export function formatFeedVolume(volume) {
  return `${Math.round(volume * 100)}%`;
}
