import React from 'react';
import FitnessPluginContainer from './FitnessPlugins/FitnessPluginContainer.jsx';

const FitnessPlayerSidebar = ({
  currentItem,
  queue,
  duration,
  formatTime,
  sidebarWidth,
  side,
  mode,
  onResizeMouseDown,
  onResizeKeyDown,
  onResetWidth,
  toggleSide,
  setMode
}) => {
  const sideClass = side === 'left' ? 'sidebar-left' : 'sidebar-right';
  const minimized = mode === 'fullscreen';
  return (
    <div
      className={`fitness-player-sidebar ${sideClass}${minimized ? ' minimized' : ''}`}
      style={{ width: minimized ? 0 : sidebarWidth, flex: `0 0 ${minimized ? 0 : sidebarWidth}px`, order: side === 'right' ? 2 : 0 }}
    >
      {(!minimized && mode !== 'maximal') && (
        <div
          className="fitness-player-sidebar-resizer"
          onMouseDown={onResizeMouseDown}
          onKeyDown={onResizeKeyDown}
          role="separator"
          aria-label="Resize sidebar"
          aria-orientation="vertical"
          tabIndex={0}
          title="Drag (or use arrows) to resize sidebar. Double-click or press Enter to reset."
          onDoubleClick={onResetWidth}
          data-side={side}
        />
      )}

      {!minimized && (
        <div className="sidebar-content">
          <FitnessPluginContainer pluginId="fitness_cam" mode="standalone" />
        </div>
      )}

      <div className="sidebar-footer-controls" style={{display:"none"}}>
        <button type="button" onPointerDown={() => setMode('fullscreen')} className={`sidebar-footer-btn${mode==='fullscreen'?' active':''}`} title="Fullscreen">Full</button>
        <button type="button" onPointerDown={() => setMode('normal')} className={`sidebar-footer-btn${mode==='normal'?' active':''}`} title="Normal">Norm</button>
        <button type="button" onPointerDown={() => setMode('maximal')} className={`sidebar-footer-btn${mode==='maximal'?' active':''}`} title="Maximal">Max</button>
        <button type="button" onPointerDown={toggleSide} className="sidebar-footer-btn switch-side" title="Switch sidebar side">{side === 'right' ? '◀' : '▶'}</button>
      </div>

    </div>
  );
};

export default FitnessPlayerSidebar;
