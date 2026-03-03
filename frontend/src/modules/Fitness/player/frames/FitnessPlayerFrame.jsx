import React, { forwardRef } from 'react';
import PropTypes from 'prop-types';
import './FitnessPlayerFrame.scss';

/**
 * FitnessPlayerFrame - Level 0 Layout Shell for Player Views
 * 
 * Provides the layout structure for video playback and session experiences:
 * - children: Main content area (video, chart, etc.)
 * - sidebar: Right sidebar (panels, controls)
 * - footer: Bottom footer (seek controls, timeline)
 * - overlay: Absolute overlay layer (governance, voice memo, etc.)
 * 
 * This is a pure layout component with no business logic.
 * Layout adapts based on mode (normal, fullscreen) and sidebar visibility.
 * 
 * @example
 * <FitnessPlayerFrame
 *   sidebar={<PlayerSidebar />}
 *   footer={<PlayerFooter />}
 *   overlay={<OverlayStack />}
 *   mode="normal"
 *   sidebarSide="right"
 *   sidebarWidth={250}
 * >
 *   <VideoPlayer />
 * </FitnessPlayerFrame>
 */
const FitnessPlayerFrame = forwardRef(({
  children,
  sidebar = null,
  footer = null,
  overlay = null,
  mode = 'normal',
  sidebarSide = 'right',
  sidebarWidth = 250,
  className = '',
  contentRef = null,
  mainRef = null,
  footerRef = null,
  onContentPointerDown = null,
  onRootPointerDownCapture = null,
  ...props
}, ref) => {
  const isFullscreen = mode === 'fullscreen';
  const showSidebar = !isFullscreen && sidebar;
  const showFooter = !isFullscreen && footer;

  const rootClasses = [
    'fitness-player-frame',
    `fitness-player-frame--mode-${mode}`,
    `fitness-player-frame--sidebar-${sidebarSide}`,
    !showSidebar && 'fitness-player-frame--no-sidebar',
    !showFooter && 'fitness-player-frame--no-footer',
    className
  ].filter(Boolean).join(' ');

  const sidebarStyle = showSidebar ? {
    width: sidebarWidth,
    flex: `0 0 ${sidebarWidth}px`
  } : { width: 0, flex: '0 0 0px' };

  return (
    <div 
      className={rootClasses} 
      ref={ref} 
      onPointerDownCapture={onRootPointerDownCapture}
      {...props}
    >
      {/* Sidebar Slot */}
      {sidebar && (
        <div
          className={`fitness-player-frame__sidebar ${isFullscreen ? 'fitness-player-frame__sidebar--hidden' : ''}`}
          style={sidebarStyle}
          aria-hidden={isFullscreen}
        >
          <div className="fitness-player-frame__sidebar-content">
            {sidebar}
          </div>
        </div>
      )}

      {/* Main Area (Content + Footer) */}
      <div className="fitness-player-frame__main" ref={mainRef}>
        {/* Content Slot */}
        <div
          className="fitness-player-frame__content"
          ref={contentRef}
          onPointerDown={onContentPointerDown}
        >
          {children}
        </div>

        {/* Footer Slot */}
        {footer && (
          <div
            className={`fitness-player-frame__footer ${isFullscreen ? 'fitness-player-frame__footer--hidden' : ''}`}
            ref={footerRef}
            aria-hidden={isFullscreen}
          >
            {footer}
          </div>
        )}
      </div>

      {/* Overlay Slot */}
      {overlay && (
        <div className="fitness-player-frame__overlay">
          {overlay}
        </div>
      )}
    </div>
  );
});

FitnessPlayerFrame.displayName = 'FitnessPlayerFrame';

FitnessPlayerFrame.propTypes = {
  /** Main content (video, chart, etc.) */
  children: PropTypes.node,
  /** Sidebar content (panels, controls) */
  sidebar: PropTypes.node,
  /** Footer content (seek controls, timeline) */
  footer: PropTypes.node,
  /** Overlay content (governance, voice memo, etc.) */
  overlay: PropTypes.node,
  /** Layout mode */
  mode: PropTypes.oneOf(['normal', 'fullscreen']),
  /** Sidebar position */
  sidebarSide: PropTypes.oneOf(['left', 'right']),
  /** Sidebar width in pixels */
  sidebarWidth: PropTypes.number,
  /** Additional CSS classes */
  className: PropTypes.string,
  /** Ref for content area */
  contentRef: PropTypes.oneOfType([
    PropTypes.func,
    PropTypes.shape({ current: PropTypes.any })
  ]),
  /** Ref for main area */
  mainRef: PropTypes.oneOfType([
    PropTypes.func,
    PropTypes.shape({ current: PropTypes.any })
  ]),
  /** Ref for footer area */
  footerRef: PropTypes.oneOfType([
    PropTypes.func,
    PropTypes.shape({ current: PropTypes.any })
  ]),
  /** Pointer down handler for content area */
  onContentPointerDown: PropTypes.func,
  /** Pointer down capture handler for root element (for fullscreen toggle) */
  onRootPointerDownCapture: PropTypes.func
};

export default FitnessPlayerFrame;
