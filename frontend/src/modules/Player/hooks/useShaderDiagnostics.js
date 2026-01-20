import { useEffect, useCallback, useRef } from 'react';
import { getLogger } from '../../../lib/logging/Logger.js';

/**
 * Diagnostic hook for tracking shader overlay dimensions vs viewport.
 * Logs discrepancies that could cause visual artifacts (e.g., white lines at edges).
 *
 * @param {Object} options
 * @param {React.RefObject} options.shaderRef - Ref to the shader element
 * @param {React.RefObject} [options.containerRef] - Ref to the parent container
 * @param {boolean} [options.enabled=true] - Whether logging is active
 * @param {string} [options.label='shader'] - Label prefix for log entries
 * @param {string} [options.shaderState] - Current shader state (on/off) - triggers log on change
 */
export function useShaderDiagnostics({
  shaderRef,
  containerRef,
  enabled = true,
  label = 'shader',
  shaderState
}) {
  const lastLogRef = useRef(null);

  const logDimensions = useCallback((trigger = 'manual') => {
    if (!enabled) return;

    const logger = getLogger();
    const shaderEl = shaderRef?.current;
    const containerEl = containerRef?.current;

    const shaderRect = shaderEl?.getBoundingClientRect?.() ?? null;
    const containerRect = containerEl?.getBoundingClientRect?.() ?? null;

    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight
    };

    // Calculate gaps between shader and viewport edges
    const discrepancy = shaderRect ? {
      top: shaderRect.y,
      left: shaderRect.x,
      bottom: viewport.height - (shaderRect.y + shaderRect.height),
      right: viewport.width - (shaderRect.x + shaderRect.width),
      widthDiff: viewport.width - shaderRect.width,
      heightDiff: viewport.height - shaderRect.height
    } : null;

    // Flag if any edge has a gap > 0.5px (subpixel tolerance)
    const hasGap = discrepancy && (
      Math.abs(discrepancy.top) > 0.5 ||
      Math.abs(discrepancy.left) > 0.5 ||
      Math.abs(discrepancy.bottom) > 0.5 ||
      Math.abs(discrepancy.right) > 0.5
    );

    // Get computed styles that might affect dimensions
    const shaderStyles = shaderEl ? window.getComputedStyle(shaderEl) : null;
    const computedInfo = shaderStyles ? {
      position: shaderStyles.position,
      top: shaderStyles.top,
      left: shaderStyles.left,
      width: shaderStyles.width,
      height: shaderStyles.height,
      transform: shaderStyles.transform !== 'none' ? shaderStyles.transform : null
    } : null;

    const payload = {
      trigger,
      shaderState,
      shader: shaderRect ? {
        x: Math.round(shaderRect.x * 100) / 100,
        y: Math.round(shaderRect.y * 100) / 100,
        width: Math.round(shaderRect.width * 100) / 100,
        height: Math.round(shaderRect.height * 100) / 100
      } : null,
      container: containerRect ? {
        x: Math.round(containerRect.x * 100) / 100,
        y: Math.round(containerRect.y * 100) / 100,
        width: Math.round(containerRect.width * 100) / 100,
        height: Math.round(containerRect.height * 100) / 100
      } : null,
      viewport,
      discrepancy: discrepancy ? {
        top: Math.round(discrepancy.top * 100) / 100,
        left: Math.round(discrepancy.left * 100) / 100,
        bottom: Math.round(discrepancy.bottom * 100) / 100,
        right: Math.round(discrepancy.right * 100) / 100
      } : null,
      hasGap,
      computed: computedInfo,
      ts: Date.now()
    };

    // Store for comparison
    lastLogRef.current = payload;

    // Log at warn level if there's a gap, otherwise info
    const logLevel = hasGap ? 'warn' : 'info';
    logger[logLevel](`${label}.dimensions`, payload);

    return payload;
  }, [enabled, shaderRef, containerRef, label, shaderState]);

  // Log on mount
  useEffect(() => {
    if (!enabled) return;

    // Small delay to ensure layout is complete
    const timeoutId = setTimeout(() => {
      logDimensions('mount');
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [enabled, logDimensions]);

  // Log on resize
  useEffect(() => {
    if (!enabled) return;

    const handleResize = () => {
      logDimensions('resize');
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [enabled, logDimensions]);

  // Log on shader state change
  useEffect(() => {
    if (!enabled || shaderState === undefined) return;

    logDimensions('state-change');
  }, [enabled, shaderState, logDimensions]);

  return {
    logDimensions,
    getLastLog: () => lastLogRef.current
  };
}
