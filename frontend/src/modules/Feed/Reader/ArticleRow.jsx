import { useState, useRef, useEffect, useCallback } from 'react';
import { colorFromLabel } from '../Scroll/cards/utils.js';
import FeedPlayer from '../players/FeedPlayer.jsx';
import { useFeedPlayer } from '../players/FeedPlayerContext.jsx';
import { DaylightAPI } from '../../../lib/api.mjs';

/**
 * Single article row with collapsed/expanded accordion states.
 * @param {Object} props
 * @param {Object} props.article - article object from /reader/stream
 * @param {Function} props.onMarkRead - (articleId) => void
 */
export default function ArticleRow({ article, onMarkRead }) {
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

  const faviconUrl = article.iconUrl || null;

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
          {article.contentType === 'youtube' && article.meta?.videoId ? (
            <>
              <ReaderYouTubePlayer article={article} />
              {article.preview && (
                <p className="article-content">{article.preview}</p>
              )}
              {article.link && (
                <a
                  className="article-source-link"
                  href={article.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  Open on YouTube &rarr;
                </a>
              )}
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ReaderYouTubePlayer({ article }) {
  const { play } = useFeedPlayer();
  const [playerData, setPlayerData] = useState(null);
  const [fetchDone, setFetchDone] = useState(false);
  const [useEmbed, setUseEmbed] = useState(false);

  // Notify FeedPlayerContext when native playback resolves (preemption system)
  useEffect(() => {
    if (playerData) {
      play({ ...article, id: `youtube:${article.meta.videoId}` });
    }
  }, [playerData]);  // Only when playerData changes from null to resolved

  // Fetch detail from API to get Piped stream URL
  useEffect(() => {
    const params = new URLSearchParams();
    params.set('quality', '720p');
    if (article.meta) params.set('meta', JSON.stringify(article.meta));
    DaylightAPI(`/api/v1/feed/detail/${encodeURIComponent(`youtube:${article.meta.videoId}`)}?${params}`)
      .then(result => {
        const section = result?.sections?.find(s => s.type === 'player' && s.data?.provider === 'youtube');
        if (section) setPlayerData(section.data);
        setFetchDone(true);
      })
      .catch(() => setFetchDone(true)); // fall back to embed
  }, [article.meta]);

  const handleStreamError = useCallback(() => {
    setUseEmbed(true);
  }, []);

  const wrapperStyle = (article.meta?.imageWidth && article.meta?.imageHeight && article.meta.imageHeight > article.meta.imageWidth) ? {
    paddingBottom: `${(article.meta.imageHeight / article.meta.imageWidth) * 100}%`,
    maxWidth: '360px',
    maxHeight: '80vh',
  } : undefined;

  // Loading — don't show iframe yet
  if (!fetchDone) {
    return (
      <div className="youtube-embed-wrapper" style={wrapperStyle}>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000' }}>
          <div className="scroll-loading-dots"><span /><span /><span /></div>
        </div>
      </div>
    );
  }

  // Native playback via Piped
  if (playerData && !useEmbed && (playerData.videoUrl || playerData.url)) {
    const ar = (article.meta?.imageWidth && article.meta?.imageHeight)
      ? `${article.meta.imageWidth} / ${article.meta.imageHeight}`
      : '16 / 9';
    return (
      <FeedPlayer
        playerData={playerData}
        onError={handleStreamError}
        aspectRatio={ar}
      />
    );
  }

  // Embed fallback
  return (
    <div className="youtube-embed-wrapper" style={wrapperStyle}>
      <iframe
        src={`https://www.youtube.com/embed/${article.meta.videoId}?rel=0`}
        title={article.title}
        allow="autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
        className="youtube-embed"
      />
    </div>
  );
}
