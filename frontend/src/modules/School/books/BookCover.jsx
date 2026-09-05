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
  return (
    <div
      className={`school-selfservice-card__poster-placeholder school-books-cover ${className}`.trim()}
      role="img"
      aria-label={`No cover available for ${title}`}
    >
      <span aria-hidden="true">✦</span>
    </div>
  );
}
