import React, { useRef, useState, useEffect } from 'react';
import { DaylightMediaPath } from '@/lib/api.mjs';
import '../FitnessSidebar.scss';

const DEFAULT_PAGE_SIZE = 6;
const VISIBLE_ROWS = 2;

const FitnessPlaylistSelector = ({ playlists, selectedPlaylistId, onSelect, onClose, isOpen }) => {
  const panelRef = useRef(null);
  const gridRef = useRef(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
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
  // First page holds (pageSize - 1) real items (last slot is "next" if needed),
  // subsequent middle pages hold (pageSize - 2) (prev + next reserved).
  const itemsAfterFirstPage = Math.max(1, pageSize - 2);
  const totalPages = totalItems <= pageSize
    ? 1
    : 1 + Math.ceil((totalItems - (pageSize - 1)) / itemsAfterFirstPage);
  const hasMultiplePages = totalPages > 1;
  const isFirstPage = page === 0;
  const isLastPage = page >= totalPages - 1;

  // Reset to first page if pagination collapsed past current selection
  useEffect(() => {
    if (page > 0 && page >= totalPages) {
      setPage(Math.max(0, totalPages - 1));
    }
  }, [page, totalPages]);

  // Track rendered column count so each "page" matches the visible grid width
  useEffect(() => {
    if (!isOpen || !gridRef.current || typeof window === 'undefined') return undefined;
    const measure = () => {
      const grid = gridRef.current;
      if (!grid) return;
      const computed = window.getComputedStyle(grid);
      const colsValue = computed.gridTemplateColumns || '';
      const cols = colsValue.split(' ').filter(Boolean).length;
      if (cols > 0) {
        const next = cols * VISIBLE_ROWS;
        setPageSize((prev) => (prev === next ? prev : next));
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(gridRef.current);
    return () => ro.disconnect();
  }, [isOpen]);

  // Calculate visible items for current page
  const getVisibleItems = () => {
    const items = [];

    if (!hasMultiplePages) {
      return allItems;
    }

    const hasPrev = !isFirstPage;
    const hasNext = !isLastPage;
    const reservedSlots = (hasPrev ? 1 : 0) + (hasNext ? 1 : 0);
    const itemSlots = Math.max(1, pageSize - reservedSlots);

    let startIdx;
    if (isFirstPage) {
      startIdx = 0;
    } else {
      startIdx = (pageSize - 1) + (page - 1) * itemsAfterFirstPage;
    }

    const pageItems = allItems.slice(startIdx, startIdx + itemSlots);

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

        <div className="playlist-panel-grid" ref={gridRef}>
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
