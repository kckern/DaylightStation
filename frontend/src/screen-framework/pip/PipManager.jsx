// frontend/src/screen-framework/pip/PipManager.jsx
import React, { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import ReactDOM from 'react-dom';
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
  const [content, setContent] = useState(null); // { Component, props, config, mode, target? }
  const [animating, setAnimating] = useState(false); // for corner slide-in/out
  const timerRef = useRef(null);
  const dismissAnimRef = useRef(null);
  const contentRef = useRef(null);
  const dismissRef = useRef(null);

  // Slot registry: id -> DOM node. Populated by PanelRenderer via registerSlot.
  const slotsRef = useRef(new Map());

  const registerSlot = useCallback((id, node) => {
    if (!id || !node) return;
    slotsRef.current.set(id, node);
    logger().debug('slot.registered', { id });
  }, []);

  const unregisterSlot = useCallback((id) => {
    if (!id) return;
    slotsRef.current.delete(id);
    logger().debug('slot.unregistered', { id });
  }, []);

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

    const mode = callConfig.mode === 'panel' ? 'panel' : 'corner';
    const merged = mergeConfig(callConfig);

    if (mode === 'panel') {
      const target = callConfig.target;
      const slotNode = target ? slotsRef.current.get(target) : null;
      if (!slotNode) {
        logger().warn('pip.slot-not-found', { target });
        return;
      }
      const newContent = { Component, props, config: merged, mode: 'panel', target };
      contentRef.current = newContent;
      setContent(newContent);
      logger().info('pip.show', { mode: 'panel', target, timeout: merged.timeout, slotFound: true });
      setState('visible');
      startTimer(merged.timeout);
      return;
    }

    // Corner mode
    const newContent = { Component, props, config: merged, mode: 'corner' };
    contentRef.current = newContent;
    setContent(newContent);

    if (state === 'visible') {
      // Already showing — reset timer, update content
      logger().debug('pip.refresh', { mode: 'corner', position: merged.position });
      startTimer(merged.timeout);
    } else {
      logger().info('pip.show', { mode: 'corner', position: merged.position, size: merged.size, timeout: merged.timeout });
      setAnimating(true);
      setState('visible');
      startTimer(merged.timeout);
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

    const curMode = contentRef.current?.mode;
    logger().info('pip.dismiss', { mode: curMode });

    if (curMode === 'panel') {
      // Panel dismiss: fade via Web Animations API handled in PipPanelPortal;
      // here we just flip state after a short delay to let the fade play.
      dismissAnimRef.current = setTimeout(() => {
        dismissAnimRef.current = null;
        setState('idle');
        setContent(null);
        contentRef.current = null;
      }, 200);
      return;
    }

    // Corner dismiss: slide-out via CSS class, then clean up
    setAnimating(true);
    dismissAnimRef.current = setTimeout(() => {
      dismissAnimRef.current = null;
      setState('idle');
      setContent(null);
      contentRef.current = null;
      setAnimating(false);
    }, 300);
  }, [state, clearTimer, dismissOverlay]);

  // Keep ref in sync for timer callback
  dismissRef.current = dismiss;

  const promote = useCallback(() => {
    if (state !== 'visible') return;
    clearTimer();

    const cur = contentRef.current;
    if (!cur) return;

    logger().info('pip.promote', { component: cur.Component?.name, fromMode: cur.mode });
    setState('fullscreen');
    setContent(null);

    const fullscreenProps = { ...cur.props, dismiss: () => dismiss() };
    showOverlay(cur.Component, fullscreenProps, { mode: 'fullscreen', priority: 'high' });
  }, [state, clearTimer, showOverlay, dismiss]);

  useEffect(() => {
    return () => clearTimer();
  }, [clearTimer]);

  const hasPip = state !== 'idle';

  const ctx = useMemo(() => ({
    show, dismiss, promote, state, hasPip, registerSlot, unregisterSlot,
  }), [show, dismiss, promote, state, hasPip, registerSlot, unregisterSlot]);

  // Compute corner-mode position/size styles
  const pipStyle = useMemo(() => {
    if (!content || state !== 'visible' || content.mode !== 'corner') return {};
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
    if (position.includes('top')) style.top = `${margin}px`;
    if (position.includes('bottom')) style.bottom = `${margin}px`;
    if (position.includes('right')) style.right = `${margin}px`;
    if (position.includes('left')) style.left = `${margin}px`;
    return style;
  }, [content, state]);

  const animClass = useMemo(() => {
    if (state !== 'visible' || content?.mode !== 'corner') return '';
    const pos = content?.config?.position || 'bottom-right';
    if (animating) return `pip-container--entering pip-container--from-${pos}`;
    return 'pip-container--visible';
  }, [state, content, animating]);

  const showingCorner = state === 'visible' && content && content.mode === 'corner';
  const showingPanel = state === 'visible' && content && content.mode === 'panel';
  const dismissingPanel = !!dismissAnimRef.current && content?.mode === 'panel';
  const panelSlotNode = showingPanel ? slotsRef.current.get(content.target) : null;

  return (
    <PipContext.Provider value={ctx}>
      {children}
      {showingCorner && (
        <div className={`pip-container ${animClass}`} style={pipStyle}>
          <content.Component {...content.props} dismiss={dismiss} />
        </div>
      )}
      {showingPanel && panelSlotNode && ReactDOM.createPortal(
        <PipPanelPortal
          slotNode={panelSlotNode}
          dismissing={dismissingPanel}
          Component={content.Component}
          componentProps={content.props}
          dismiss={dismiss}
        />,
        panelSlotNode
      )}
    </PipContext.Provider>
  );
}

/**
 * Rendered via portal into the target slot. Manages:
 *  - data-pip-occupied attribute on slot node (CSS hides native children)
 *  - position:relative on slot node (so our absolute-positioned overlay fills it)
 *  - Web Animations API fade-in on mount, fade-out when `dismissing` turns true
 *    (WAA is used because the TV app kills CSS transitions globally).
 */
function PipPanelPortal({ slotNode, dismissing, Component, componentProps, dismiss }) {
  const wrapperRef = useRef(null);
  const prevPositionRef = useRef(null);

  // Set data attribute + position on slot; restore on unmount
  useEffect(() => {
    if (!slotNode) return;
    prevPositionRef.current = slotNode.style.position;
    if (!slotNode.style.position || slotNode.style.position === 'static') {
      slotNode.style.position = 'relative';
    }
    slotNode.setAttribute('data-pip-occupied', 'true');
    return () => {
      slotNode.removeAttribute('data-pip-occupied');
      slotNode.style.position = prevPositionRef.current || '';
    };
  }, [slotNode]);

  // Fade-in via WAA on mount
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || typeof el.animate !== 'function') return;
    el.animate(
      [{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'scale(1)' }],
      { duration: 200, easing: 'ease-out', fill: 'forwards' }
    );
  }, []);

  // Fade-out when dismissing
  useEffect(() => {
    if (!dismissing) return;
    const el = wrapperRef.current;
    if (!el || typeof el.animate !== 'function') return;
    el.animate(
      [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.98)' }],
      { duration: 180, easing: 'ease-in', fill: 'forwards' }
    );
  }, [dismissing]);

  return (
    <div ref={wrapperRef} className="pip-panel" style={{ position: 'absolute', inset: 'var(--screen-panel-padding, 1rem)', zIndex: 1001 }}>
      <div className="pip-panel-chrome">
        <Component {...componentProps} dismiss={dismiss} />
      </div>
    </div>
  );
}

export function usePip() {
  const ctx = useContext(PipContext);
  if (!ctx) {
    return {
      show: () => {}, dismiss: () => {}, promote: () => {},
      state: 'idle', hasPip: false,
      registerSlot: () => {}, unregisterSlot: () => {},
    };
  }
  return ctx;
}
