import React, { useMemo, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useContentDetail } from '../../hooks/media/useContentDetail.js';
import { useMediaApp } from '../../contexts/MediaAppContext.jsx';
import { ContentDisplayUrl } from '../../lib/api.mjs';
import { resolveContentId } from './SearchHomePanel.jsx';
import CastButton from './CastButton.jsx';
import getLogger from '../../lib/logging/Logger.js';

const ContentDetailView = ({ contentId, onTitleResolved }) => {
  const navigate = useNavigate();
  const { queue } = useMediaApp();
  const logger = useMemo(() => getLogger().child({ component: 'ContentDetailView' }), []);
  const { data, children, loading, error } = useContentDetail(contentId);
  const playingRef = useRef(false);

  // Notify parent of title once data loads (for breadcrumbs)
  useEffect(() => {
    if (data?.title) onTitleResolved?.(data.title);
  }, [data?.title, onTitleResolved]);

  const handleBack = useCallback(() => {
    navigate(-1);
  }, [navigate]);

  const handlePlayNow = useCallback((item) => {
    if (playingRef.current) return;
    playingRef.current = true;
    setTimeout(() => { playingRef.current = false; }, 2000);
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
  }, [contentId, data, queue, logger]);

  const handleAddToQueue = useCallback((item) => {
    const id = item ? resolveContentId(item) : contentId;
    const title = item?.title || data?.title;
    logger.info('detail.add-to-queue', { contentId: id, title });
    queue.addItems([{ contentId: id, title, format: item?.format || data?.format, thumbnail: item?.thumbnail || data?.thumbnail }]);
  }, [contentId, data, queue, logger]);

  const handleShuffle = useCallback(() => {
    logger.info('detail.shuffle', { contentId });
    if (children.length > 0) {
      const shuffled = [...children].sort(() => Math.random() - 0.5);
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

  return (
    <div className="content-detail-view">
      <div className="content-detail-hero" style={{ backgroundImage: `url(${heroImage})` }}>
        <div className="content-detail-hero-overlay">
          <button className="content-detail-back" onClick={handleBack}>&larr;</button>
        </div>
      </div>

      <div className="content-detail-title-bar">
        <h2 className="content-detail-title">{data.title}</h2>
        <div className="content-detail-meta">
          {data.source && <span className="source-badge">{data.source}</span>}
          {data.format && <span className={`format-badge format-badge--${data.format}`}>{data.format}</span>}
          {data.type && <span className="type-badge">{data.type}</span>}
          {data.duration && <span className="duration">{Math.round(data.duration / 60)}m</span>}
        </div>
        {(data.subtitle || data.metadata?.artist || data.metadata?.albumArtist) && (
          <div className="content-detail-subtitle">
            {data.subtitle || data.metadata?.artist || data.metadata?.albumArtist}
          </div>
        )}
      </div>

      <div className="content-detail-actions">
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

      {(data.metadata?.summary || data.metadata?.tagline) && (
        <div className="content-detail-summary">
          {data.metadata?.tagline && <p className="content-detail-tagline">{data.metadata.tagline}</p>}
          {data.metadata?.summary && <p>{data.metadata.summary}</p>}
        </div>
      )}

      {isContainer && (
        <div className="content-detail-children">
          {children.map((child, i) => {
            const childId = child.id || child.contentId;
            const childThumb = child.thumbnail || child.image || (childId ? ContentDisplayUrl(childId) : null);
            return (
              <div key={childId || i} className="content-detail-child-item">
                <div className="child-item-thumb" onClick={() => handleChildClick(child)}>
                  {childThumb && <img src={childThumb} alt="" />}
                </div>
                <div className="child-item-info" onClick={() => handleChildClick(child)}>
                  <div className="child-item-title">
                    {child.itemIndex !== undefined && <span className="child-item-index">{child.itemIndex}.</span>}
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
      )}
    </div>
  );
};

export default ContentDetailView;
