import React, { useRef, useState } from 'react';
import { DaylightMediaPath } from '../../../lib/api.mjs';
import '../FitnessSidebar.scss';

const GRID_SIZE = 6; // 3x2 grid

const FitnessPlaylistSelector = ({ playlists, selectedPlaylistId, onSelect, onClose, isOpen }) => {
  const panelRef = useRef(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [page, setPage] = useState(0);
  const dragStartY = useRef(0);

  // Build full list with "No Music" as first item
  const allItems = [
    { id: null, name: 'No Music', meta: 'Disable music', isNoMusic: true },
    ...playlists.map(p => ({
      id: p.id,
      name: p.name,
      thumb: p.thumb || p.composite || p.art,
      meta: p.trackCount ? `${p.trackCount} tracks` : null
    }))
  ];

  const totalItems = allItems.length;
  const totalPages = Math.ceil(totalItems / GRID_SIZE);
  const hasMultiplePages = totalPages > 1;
  const isFirstPage = page === 0;
  const isLastPage = page >= totalPages - 1;

  // Calculate visible items for current page
  const getVisibleItems = () => {
    const items = [];

    if (!hasMultiplePages) {
      // No pagination needed - show all items
      return allItems;
    }

    // Calculate slots available for actual items
    const hasPrev = !isFirstPage;
    const hasNext = !isLastPage;
    const reservedSlots = (hasPrev ? 1 : 0) + (hasNext ? 1 : 0);
    const itemSlots = GRID_SIZE - reservedSlots;

    // Calculate start index
    let startIdx;
    if (isFirstPage) {
      startIdx = 0;
    } else {
      // First page shows 5 items (slot 6 is next)
      // Subsequent pages show 4 items (slot 1 is prev, slot 6 is next, unless last page)
      startIdx = 5 + (page - 1) * 4;
    }

    const pageItems = allItems.slice(startIdx, startIdx + itemSlots);

    // Build grid with nav buttons
    if (hasPrev) {
      items.push({ isNavPrev: true });
    }
    items.push(...pageItems);
    if (hasNext) {
      items.push({ isNavNext: true });
    }

    return items;
  };

  const visibleItems = getVisibleItems();

  const handleSelect = (playlistId) => {
    onSelect(playlistId);
    if (onClose) onClose();
  };

  const handleDragStart = (e) => {
    setIsDragging(true);
    dragStartY.current = e.clientY || e.touches?.[0]?.clientY || 0;
  };

  const handleDragMove = (e) => {
    if (!isDragging) return;
    const currentY = e.clientY || e.touches?.[0]?.clientY || 0;
    const delta = currentY - dragStartY.current;
    if (delta > 0) {
      setDragOffset(delta);
    }
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    if (dragOffset > 100) {
      onClose?.();
    }
    setDragOffset(0);
  };

  if (!isOpen) return null;

  return (
    <div
      className={`playlist-slideup-overlay ${isOpen ? 'open' : ''}`}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className={`playlist-slideup-panel ${isDragging ? 'dragging' : ''}`}
        style={{ transform: dragOffset > 0 ? `translateY(${dragOffset}px)` : undefined }}
        onClick={e => e.stopPropagation()}
        onMouseMove={handleDragMove}
        onMouseUp={handleDragEnd}
        onMouseLeave={handleDragEnd}
        onTouchMove={handleDragMove}
        onTouchEnd={handleDragEnd}
      >
        {/* Drag Handle */}
        <div
          className="playlist-drag-handle"
          onMouseDown={handleDragStart}
          onTouchStart={handleDragStart}
        >
          <div className="handle-bar" />
        </div>

        {/* Header */}
        <div className="playlist-panel-header">
          <span className="panel-title">Select Playlist</span>
          <span className="panel-current">
            {playlists.find(p => p.id === selectedPlaylistId)?.name || 'None'}
          </span>
        </div>

        {/* 3x3 Grid */}
        <div className="playlist-panel-grid">
          {visibleItems.map((item, idx) => {
            if (item.isNavPrev) {
              return (
                <div
                  key="nav-prev"
                  className="playlist-grid-item nav-button"
                  onClick={(e) => { e.stopPropagation(); setPage(p => p - 1); }}
                >
                  <div className="nav-icon">←</div>
                  <div className="nav-label">Back</div>
                </div>
              );
            }

            if (item.isNavNext) {
              return (
                <div
                  key="nav-next"
                  className="playlist-grid-item nav-button"
                  onClick={(e) => { e.stopPropagation(); setPage(p => p + 1); }}
                >
                  <div className="nav-icon">→</div>
                  <div className="nav-label">More</div>
                </div>
              );
            }

            const isSelected = selectedPlaylistId === item.id;
            return (
              <div
                key={item.id ?? 'no-music'}
                className={`playlist-grid-item ${isSelected ? 'selected' : ''}`}
                onClick={(e) => { e.stopPropagation(); handleSelect(item.id); }}
              >
                <div className="playlist-thumb">
                  {item.thumb ? (
                    <img src={DaylightMediaPath(item.thumb)} alt={item.name} />
                  ) : (
                    <div className="placeholder">
                      <span>{item.isNoMusic ? '🔇' : '🎵'}</span>
                    </div>
                  )}
                </div>
                <div className="playlist-name">{item.name}</div>
                {isSelected && <div className="selected-indicator">✓</div>}
              </div>
            );
          })}
        </div>

        {/* Page indicator */}
        {hasMultiplePages && (
          <div className="playlist-page-indicator">
            {page + 1} / {totalPages}
          </div>
        )}
      </div>
    </div>
  );
};

export default FitnessPlaylistSelector;
