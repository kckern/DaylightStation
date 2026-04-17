// frontend/src/screen-framework/pip/PipManager.jsx
import React, { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useScreenOverlay } from '../overlays/ScreenOverlayProvider.jsx';
import getLogger from '../../lib/logging/Logger.js';
import './PipManager.css';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'PipManager' });
  return _logger;
}

const PipContext = createContext(null);

const DEFAULTS = {
  position: 'bottom-right',
  size: 25,
  margin: 16,
  timeout: 30,
};

export function PipManager({ config: screenPipConfig, children }) {
  const { showOverlay, dismissOverlay } = useScreenOverlay();

  const [state, setState] = useState('idle'); // idle | visible | fullscreen
  const [content, setContent] = useState(null); // { Component, props, config }
  const [animating, setAnimating] = useState(false); // for slide-in/out
  const timerRef = useRef(null);
  const dismissAnimRef = useRef(null); // dismiss animation timeout
  const contentRef = useRef(null); // for promote() to access current content
  const dismissRef = useRef(null); // stable ref for timer callback

  // Merge screen-level defaults with per-call config
  const mergeConfig = useCallback((callConfig = {}) => {
    return { ...DEFAULTS, ...screenPipConfig, ...callConfig };
  }, [screenPipConfig]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback((timeoutSec) => {
    clearTimer();
    if (timeoutSec > 0) {
      timerRef.current = setTimeout(() => {
        logger().info('pip.timeout', { timeoutSec });
        dismissRef.current?.();
      }, timeoutSec * 1000);
    }
  }, [clearTimer]);

  const show = useCallback((Component, props = {}, callConfig = {}) => {
    // Ignore show while fullscreen — user must dismiss fullscreen first
    if (state === 'fullscreen') {
      logger().debug('pip.show-while-fullscreen-ignored');
      return;
    }

    // Cancel any pending dismiss animation
    if (dismissAnimRef.current) {
      clearTimeout(dismissAnimRef.current);
      dismissAnimRef.current = null;
      setAnimating(false);
    }

    const merged = mergeConfig(callConfig);
    const newContent = { Component, props, config: merged };
    contentRef.current = newContent;
    setContent(newContent);

    if (state === 'visible') {
      // Already showing — reset timer, update content
      logger().debug('pip.refresh', { position: merged.position });
      startTimer(merged.timeout);
    } else {
      logger().info('pip.show', { position: merged.position, size: merged.size, timeout: merged.timeout });
      setAnimating(true);
      setState('visible');
      startTimer(merged.timeout);
      // Animation class triggers slide-in via CSS; after transition, clear animating flag
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setAnimating(false));
      });
    }
  }, [state, mergeConfig, startTimer]);

  const dismiss = useCallback(() => {
    if (state === 'idle') return;
    clearTimer();

    if (state === 'fullscreen') {
      logger().info('pip.dismiss-fullscreen');
      dismissOverlay('fullscreen');
      setState('idle');
      setContent(null);
      contentRef.current = null;
      return;
    }

    logger().info('pip.dismiss');
    setAnimating(true);
    // Let CSS slide-out transition play, then clean up
    dismissAnimRef.current = setTimeout(() => {
      dismissAnimRef.current = null;
      setState('idle');
      setContent(null);
      contentRef.current = null;
      setAnimating(false);
    }, 300); // match CSS transition duration
  }, [state, clearTimer, dismissOverlay]);

  // Keep ref in sync for timer callback
  dismissRef.current = dismiss;

  const promote = useCallback(() => {
    if (state !== 'visible') return;
    clearTimer();

    const cur = contentRef.current;
    if (!cur) return;

    logger().info('pip.promote', { component: cur.Component?.name });
    setState('fullscreen');
    setContent(null);

    // Show the content's fullscreen counterpart via overlay provider
    // Pass cameraId if present so CameraViewport gets it
    const fullscreenProps = { ...cur.props, dismiss: () => dismiss() };
    showOverlay(cur.Component, fullscreenProps, { mode: 'fullscreen', priority: 'high' });
  }, [state, clearTimer, showOverlay, dismiss]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => clearTimer();
  }, [clearTimer]);

  const hasPip = state !== 'idle';

  const ctx = useMemo(() => ({
    show, dismiss, promote, state, hasPip,
  }), [show, dismiss, promote, state, hasPip]);

  // Compute position/size styles
  const pipStyle = useMemo(() => {
    if (!content || state !== 'visible') return {};
    const { position, size, margin } = content.config;
    const style = {
      position: 'absolute',
      zIndex: 1001,
      width: `${size}vw`,
      aspectRatio: '16 / 9',
      overflow: 'hidden',
      borderRadius: '8px',
      boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
    };
    // Position
    if (position.includes('top')) style.top = `${margin}px`;
    if (position.includes('bottom')) style.bottom = `${margin}px`;
    if (position.includes('right')) style.right = `${margin}px`;
    if (position.includes('left')) style.left = `${margin}px`;
    return style;
  }, [content, state]);

  // Determine animation class
  const animClass = useMemo(() => {
    if (state !== 'visible') return '';
    const pos = content?.config?.position || 'bottom-right';
    if (animating) return `pip-container--entering pip-container--from-${pos}`;
    return 'pip-container--visible';
  }, [state, content, animating]);

  return (
    <PipContext.Provider value={ctx}>
      {children}
      {state === 'visible' && content && (
        <div className={`pip-container ${animClass}`} style={pipStyle}>
          <content.Component {...content.props} dismiss={dismiss} />
        </div>
      )}
    </PipContext.Provider>
  );
}

export function usePip() {
  const ctx = useContext(PipContext);
  if (!ctx) {
    return { show: () => {}, dismiss: () => {}, promote: () => {}, state: 'idle', hasPip: false };
  }
  return ctx;
}
