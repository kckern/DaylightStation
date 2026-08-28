// resolveImageSrc.js — payload-field resolution for Displayer.jsx, split out
// so Fast Refresh can hot-reload the display component on its own.

/**
 * Pick a URL an <img> can actually render from an /info payload.
 *
 * Adapters disagree about which field carries the picture: the canvas source
 * sets `imageUrl`, list rows carry `image`/`thumbnail`, and a filesystem image
 * may only ever offer `mediaUrl`. Reading one field made a perfectly good file
 * render as an empty box whenever the backend chose a different one.
 *
 * `mediaUrl` is accepted ONLY for image payloads — a video's mediaUrl is a
 * stream, and pointing an <img> at it yields a broken-image icon that reads
 * exactly like the bug this function exists to prevent.
 *
 * @param {Object|null} data - resolved /info payload
 * @returns {string|null} renderable URL, or null when the payload carries none
 */
export function resolveImageSrc(data) {
  if (!data) return null;
  const isImage = data.mediaType === 'image' || data.type === 'image';
  return data.imageUrl
    || data.image
    || data.thumbnail
    || (isImage ? data.mediaUrl : null)
    || null;
}
