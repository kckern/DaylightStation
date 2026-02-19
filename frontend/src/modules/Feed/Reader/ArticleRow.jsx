import { useState, useRef, useEffect } from 'react';
import { colorFromLabel } from '../Scroll/cards/utils.js';
import { getContentPlugin } from '../contentPlugins/index.js';

/**
 * Single article row with collapsed/expanded accordion states.
 * @param {Object} props
 * @param {Object} props.article - article object from /reader/stream
 * @param {Function} props.onMarkRead - (articleId) => void
 */
export default function ArticleRow({ article, onMarkRead }) {
  const contentPlugin = getContentPlugin(article);
  if (contentPlugin?.ReaderRow) {
    const PluginRow = contentPlugin.ReaderRow;
    return <PluginRow article={article} onMarkRead={onMarkRead} />;
  }
  return <DefaultArticleRow article={article} onMarkRead={onMarkRead} />;
}

function DefaultArticleRow({ article, onMarkRead }) {
  const [expanded, setExpanded] = useState(false);
  const [fullHeight, setFullHeight] = useState(false);
  const contentRef = useRef(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    if (expanded && contentRef.current) {
      setOverflows(contentRef.current.scrollHeight > 400);
    }
  }, [expanded]);

  const handleExpand = () => {
    if (!expanded) {
      setExpanded(true);
      if (!article.isRead) {
        onMarkRead(article.id);
      }
    } else {
      setExpanded(false);
      setFullHeight(false);
    }
  };

  const formatTime = (published) => {
    if (!published) return '';
    const d = new Date(published);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    // Same year: show month/day + time
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (d.getFullYear() === now.getFullYear()) {
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' + time;
  };

  const primaryTag = article.tags?.[0];

  // Strip emojis from preview text
  const cleanPreview = (article.preview || '').replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').replace(/\s+/g, ' ').trim();

  // YouTube channels: proxy through our icon endpoint for channel avatars
  // Everything else: Google CDN favicon
  const isYouTube = article.feedSiteUrl?.includes('youtube.com/channel/');
  const faviconUrl = isYouTube
    ? `/api/v1/feed/icon?url=${encodeURIComponent(article.feedSiteUrl)}`
    : (article.link ? `https://www.google.com/s2/favicons?sz=16&domain=${new URL(article.link).hostname}` : null);

  return (
    <div className={`article-row ${expanded ? 'expanded' : ''} ${article.isRead ? 'read' : 'unread'}`}>
      <button className="article-row-header" onClick={handleExpand}>
        {faviconUrl && (
          <img className="article-favicon" src={faviconUrl} alt="" width="16" height="16" />
        )}
        <span className="article-title">{article.title}</span>
        {!expanded && article.feedTitle && (
          <span className="article-feed-name">&middot; {article.feedTitle} &middot;</span>
        )}
        {!expanded && (
          <span className="article-preview">{cleanPreview}</span>
        )}
        <span className="article-time">{formatTime(article.published)}</span>
        {primaryTag && (
          <span
            className="article-tag"
            style={{ backgroundColor: colorFromLabel(primaryTag) }}
          >
            {primaryTag}
          </span>
        )}
      </button>

      {expanded && (
        <div className="article-expanded">
          <div className="article-meta">
            {article.feedTitle && <span>{article.feedTitle}</span>}
            {article.author && <span> &middot; {article.author}</span>}
            {article.published && (
              <span> &middot; {new Date(article.published).toLocaleString()}</span>
            )}
          </div>
          <div
            ref={contentRef}
            className={`article-content ${fullHeight ? 'full' : ''} ${overflows && !fullHeight ? 'capped' : ''}`}
            dangerouslySetInnerHTML={{ __html: article.content }}
          />
          {overflows && !fullHeight && (
            <button className="article-readmore" onClick={(e) => { e.stopPropagation(); setFullHeight(true); }}>
              Read more
            </button>
          )}
          {article.link && (
            <a
              className="article-source-link"
              href={article.link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              Open original &rarr;
            </a>
          )}
        </div>
      )}
    </div>
  );
}
