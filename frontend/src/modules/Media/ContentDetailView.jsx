import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useContentDetail } from '../../hooks/media/useContentDetail.js';
import { useMediaApp } from '../../contexts/MediaAppContext.jsx';
import { ContentDisplayUrl } from '../../lib/api.mjs';
import { resolveContentId } from './SearchHomePanel.jsx';
import CastButton from './CastButton.jsx';
import getLogger from '../../lib/logging/Logger.js';
import { toast } from './Toast.jsx';

const DetailSummary = ({ tagline, summary }) => {
  const [expanded, setExpanded] = useState(false);
  if (!tagline && !summary) return null;
  return (
    <div className={`detail-summary${expanded ? ' detail-summary--expanded' : ''}`}>
      {tagline && <p className="detail-tagline">{tagline}</p>}
      {summary && <p className="detail-summary-text">{summary}</p>}
      {summary && summary.length > 150 && (
        <button className="detail-summary-toggle" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'less' : 'more'}
        </button>
      )}
    </div>
  );
};

function formatDuration(seconds) {
  if (!seconds || !isFinite(seconds)) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const ContentDetailView = ({ contentId, onTitleResolved }) => {
  const navigate = useNavigate();
  const { queue } = useMediaApp();
  const logger = useMemo(() => getLogger().child({ component: 'ContentDetailView' }), []);
  const { data, children, loading, error } = useContentDetail(contentId);
  const playingRef = useRef(false);
  const playTimerRef = useRef(null);

  const [childrenView, setChildrenView] = useState(() => {
    try { return localStorage.getItem('media:childrenView') || 'list'; } catch { return 'list'; }
  });
  const toggleChildrenView = useCallback(() => {
    setChildrenView(prev => {
      const next = prev === 'list' ? 'grid' : 'list';
      try { localStorage.setItem('media:childrenView', next); } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    if (data?.title) onTitleResolved?.(data.title);
  }, [data?.title, onTitleResolved]);

  useEffect(() => {
    return () => { clearTimeout(playTimerRef.current); };
  }, []);

  const handleBack = useCallback(() => {
    navigate(-1);
  }, [navigate]);

  const handlePlayNow = useCallback((item) => {
    if (playingRef.current) return;
    playingRef.current = true;
    playTimerRef.current = setTimeout(() => { playingRef.current = false; }, 2000);
    const id = item ? resolveContentId(item) : contentId;
    const title = item?.title || data?.title;
    const format = item?.format || data?.format;
    const thumbnail = item?.thumbnail || data?.thumbnail;
    logger.info('detail.play-now', { contentId: id, title });
    queue.playNow([{ contentId: id, title, format, thumbnail }]);
  }, [contentId, data, queue, logger]);

  const handlePlayNext = useCallback((item) => {
    const id = item ? resolveContentId(item) : contentId;
    const title = item?.title || data?.title;
    logger.info('detail.play-next', { contentId: id, title });
    queue.addItems([{ contentId: id, title, format: item?.format || data?.format, thumbnail: item?.thumbnail || data?.thumbnail }], 'next');
    toast(`"${title}" plays next`);
  }, [contentId, data, queue, logger]);

  const handleAddToQueue = useCallback((item) => {
    const id = item ? resolveContentId(item) : contentId;
    const title = item?.title || data?.title;
    logger.info('detail.add-to-queue', { contentId: id, title });
    queue.addItems([{ contentId: id, title, format: item?.format || data?.format, thumbnail: item?.thumbnail || data?.thumbnail }]);
    toast(`"${title}" added to queue`);
  }, [contentId, data, queue, logger]);

  const handleShuffle = useCallback(() => {
    logger.info('detail.shuffle', { contentId });
    if (children.length > 0) {
      const shuffled = [...children];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const items = shuffled.map(c => ({
        contentId: c.id || c.contentId,
        title: c.title,
        format: c.format,
        thumbnail: c.thumbnail || c.image,
      })).filter(c => c.contentId);
      queue.playNow(items);
    }
  }, [contentId, children, queue, logger]);

  const handleChildClick = useCallback((child) => {
    const childId = child.id || child.contentId;
    if (!childId) return;
    logger.info('detail.drill-down', { contentId: childId, title: child.title });
    navigate(`/media/view/${childId}`);
  }, [navigate, logger]);

  if (loading) {
    return (
      <div className="content-detail-view">
        <div className="content-detail-header">
          <button className="content-detail-back" onClick={handleBack}>&larr;</button>
        </div>
        <div className="content-detail-loading">Loading...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="content-detail-view">
        <div className="content-detail-header">
          <button className="content-detail-back" onClick={handleBack}>&larr;</button>
        </div>
        <div className="content-detail-error">{error || 'Item not found'}</div>
      </div>
    );
  }

  const heroImage = data.thumbnail || data.image || data.imageUrl || ContentDisplayUrl(contentId);
  const isContainer = children.length > 0;
  const capabilities = data.capabilities || [];

  const metaChips = [
    data.year,
    data.studio || data.metadata?.artist || data.metadata?.albumArtist,
    formatDuration(data.duration),
  ].filter(Boolean);

  const childLabel = data.type === 'show' ? 'Episodes'
    : data.type === 'artist' ? 'Albums'
    : data.type === 'album' ? 'Tracks'
    : 'Items';

  return (
    <div className="content-detail-view">
      <div className="detail-header">
        <div className="detail-poster">
          <img src={heroImage} alt="" />
        </div>
        <div className="detail-info">
          <h2 className="detail-title">{data.title}</h2>
          {metaChips.length > 0 && (
            <div className="detail-meta">
              {metaChips.map((chip, i) => (
                <span key={i} className="detail-chip">{chip}</span>
              ))}
              {data.source && <span className="source-badge">{data.source}</span>}
              {data.format && <span className={`format-badge format-badge--${data.format}`}>{data.format}</span>}
            </div>
          )}
          {(data.subtitle || data.metadata?.artist || data.metadata?.albumArtist) && (
            <div className="detail-subtitle">
              {data.subtitle || data.metadata?.artist || data.metadata?.albumArtist}
            </div>
          )}
          <DetailSummary tagline={data.tagline || data.metadata?.tagline} summary={data.summary || data.metadata?.summary} />
          <div className="detail-actions">
            {capabilities.includes('playable') && (
              <button className="action-btn action-btn--primary" onClick={() => handlePlayNow(null)}>
                &#9654; Play
              </button>
            )}
            {isContainer && (
              <button className="action-btn action-btn--primary" onClick={() => {
                const items = children.map(c => ({
                  contentId: c.id || c.contentId,
                  title: c.title,
                  format: c.format,
                  thumbnail: c.thumbnail || c.image,
                })).filter(c => c.contentId);
                queue.playNow(items);
              }}>
                &#9654; Play All
              </button>
            )}
            {(capabilities.includes('playable') || isContainer) && (
              <>
                <button className="action-btn" onClick={() => handlePlayNext(null)}>&#10549; Next</button>
                <button className="action-btn" onClick={() => handleAddToQueue(null)}>+ Queue</button>
              </>
            )}
            {isContainer && (
              <button className="action-btn" onClick={handleShuffle}>&#8645; Shuffle</button>
            )}
            <CastButton contentId={contentId} className="action-btn" />
          </div>
        </div>
      </div>

      {isContainer && (
        <>
          <div className="detail-children-header">
            <span className="detail-children-count">{children.length} {childLabel}</span>
            <div className="detail-children-toggle">
              <button
                className={`toggle-btn${childrenView === 'list' ? ' active' : ''}`}
                onClick={() => childrenView !== 'list' && toggleChildrenView()}
                aria-label="List view"
              >&#9776;</button>
              <button
                className={`toggle-btn${childrenView === 'grid' ? ' active' : ''}`}
                onClick={() => childrenView !== 'grid' && toggleChildrenView()}
                aria-label="Grid view"
              >&#9638;</button>
            </div>
          </div>
          <div className={`detail-children detail-children--${childrenView}`}>
            {children.map((child, i) => {
              const childId = child.id || child.contentId;
              const childThumb = child.thumbnail || child.image || (childId ? ContentDisplayUrl(childId) : null);
              return (
                <div key={childId || i} className="detail-child-item">
                  <div className="child-item-thumb" onClick={() => handleChildClick(child)}>
                    {childThumb && <img src={childThumb} alt="" loading="lazy" />}
                  </div>
                  <div className="child-item-info" onClick={() => handleChildClick(child)}>
                    <div className="child-item-title">
                      {child.itemIndex !== undefined && (
                        <span className="child-item-index">
                          {(data.type === 'show' || data.type === 'season') ? `Ep ${child.itemIndex}. ` : `${child.itemIndex}. `}
                        </span>
                      )}
                      {child.title}
                    </div>
                    <div className="child-item-meta">
                      {child.type && <span className="type-badge">{child.type}</span>}
                      {child.duration && <span>{Math.round(child.duration / 60)}m</span>}
                      {child.artist && <span>{child.artist}</span>}
                    </div>
                    {child.watchProgress > 0 && (
                      <div className="child-item-progress">
                        <div className="child-item-progress-bar" style={{ width: `${child.watchProgress}%` }} />
                      </div>
                    )}
                  </div>
                  <div className="child-item-actions">
                    {child.play && <button onClick={(e) => { e.stopPropagation(); handlePlayNow(child); }} title="Play">&#9654;</button>}
                    {child.play && <button onClick={(e) => { e.stopPropagation(); handlePlayNext(child); }} title="Play Next">&#10549;</button>}
                    {child.play && <button onClick={(e) => { e.stopPropagation(); handleAddToQueue(child); }} title="Add to Queue">+</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

export default ContentDetailView;
