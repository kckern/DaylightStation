// frontend/src/modules/Media/ContentBrowserPanel.jsx
import React, { useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import ContentDetailView from './ContentDetailView.jsx';
import getLogger from '../../lib/logging/Logger.js';

/**
 * Center panel: wraps ContentDetailView with breadcrumb navigation.
 * Tracks navigation history for breadcrumbs on desktop.
 */
const ContentBrowserPanel = ({ contentId }) => {
  const logger = useMemo(() => getLogger().child({ component: 'ContentBrowserPanel' }), []);
  const navigate = useNavigate();
  const historyRef = useRef([]);

  // Track breadcrumb history from route changes
  useEffect(() => {
    if (!contentId) {
      historyRef.current = [];
      return;
    }
    const current = historyRef.current;
    // If navigating back to a previous entry, trim forward history
    const existingIdx = current.findIndex(e => e.contentId === contentId);
    if (existingIdx >= 0) {
      historyRef.current = current.slice(0, existingIdx + 1);
    } else {
      historyRef.current = [...current, { contentId, title: null }];
    }
    logger.debug('browser-panel.history', { depth: historyRef.current.length, contentId });
  }, [contentId, logger]);

  // Callback to update breadcrumb title once data loads
  const handleTitleResolved = (title) => {
    const current = historyRef.current;
    if (current.length > 0) {
      current[current.length - 1].title = title;
    }
  };

  if (!contentId) {
    return (
      <div className="content-browser-panel">
        <div className="content-browser-panel-empty">
          <p>Select something to browse</p>
        </div>
      </div>
    );
  }

  const breadcrumbs = historyRef.current.slice(0, -1); // All except current

  return (
    <div className="content-browser-panel">
      {breadcrumbs.length > 0 && (
        <div className="content-browser-breadcrumbs">
          <button onClick={() => navigate(-1)}>&larr; Back</button>
          {breadcrumbs.map((b, i) => (
            <button key={i} className="breadcrumb" onClick={() => navigate(`/media/view/${b.contentId}`)}>
              {b.title || b.contentId.split(':').pop()}
            </button>
          ))}
        </div>
      )}
      <ContentDetailView contentId={contentId} onTitleResolved={handleTitleResolved} />
    </div>
  );
};

export default ContentBrowserPanel;
