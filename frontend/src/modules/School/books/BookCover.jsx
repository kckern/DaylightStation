import { useEffect, useState } from 'react';
import { presentBook } from './bookPresentation.js';

/**
 * One resilient cover implementation for confirmation, shelf, history and
 * update views. `contain` lives in SCSS so square/landscape/tall art remains
 * recognizable inside the stable portrait card.
 */
export default function BookCover({ book, className = '', loading = 'eager' }) {
  const [failed, setFailed] = useState(false);
  const rawUrl = typeof book?.coverUrl === 'string' ? book.coverUrl.trim().slice(0, 2048) : '';
  // Old cache records may still contain http; upgrade them. Refuse active or
  // opaque schemes rather than handing provider-controlled text to an image
  // element. Root-relative URLs are our own image/proxy endpoints.
  // A backslash in a nominal root path is rejected: URL parsers may normalize
  // `/\\host/path` into a protocol-relative cross-origin request.
  const safeRootPath = /^\/(?!\/)/.test(rawUrl) && !rawUrl.includes('\\');
  const url = safeRootPath || /^https:\/\//i.test(rawUrl)
    ? rawUrl
    : (/^http:\/\//i.test(rawUrl) ? rawUrl.replace(/^http:/i, 'https:')
      : (/^\/\//.test(rawUrl) ? `https:${rawUrl}` : ''));
  const title = presentBook(book).title;

  useEffect(() => setFailed(false), [url]);

  if (url && !failed) {
    return (
      <img
        className={`school-books-cover ${className}`.trim()}
        src={url}
        alt={`Cover of ${title}`}
        loading={loading}
        decoding="async"
        onError={() => setFailed(true)}
      />
    );
  }
  // NO ART: the title BECOMES the cover.
  //
  // A star on a dark square was adequate while every card carried its title
  // underneath. On a shelf where the cover IS the card, that placeholder is an
  // unidentifiable blank — the one book a child cannot find. So the fallback
  // draws a cover instead: the title set large over a hue derived from the
  // title itself, so the same book lands on the same colour every time and two
  // coverless books beside each other are told apart at a glance.
  return (
    <div
      className={`school-books-cover school-books-cover--drawn ${className}`.trim()}
      role="img"
      aria-label={`${title} (no cover art)`}
      style={{ '--drawn-hue': titleHue(title) }}
    >
      <span className="school-books-cover__drawn-title" aria-hidden="true">{title}</span>
    </div>
  );
}

/**
 * A stable hue from the title. Not random and not hashed for distribution —
 * only for REPEATABILITY: the point is that `Charlotte's Web` is the same
 * colour on every shelf, every render, so the colour becomes part of how the
 * book is recognised.
 */
function titleHue(title) {
  let hash = 0;
  for (let i = 0; i < title.length; i += 1) hash = (hash * 31 + title.charCodeAt(i)) % 360;
  return hash;
}
