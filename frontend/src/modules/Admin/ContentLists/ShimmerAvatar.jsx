// ShimmerAvatar.jsx — avatar with a shimmer placeholder while the image
// preloads. Extracted verbatim from ListsItemRow.jsx (Task 14).
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Avatar } from '@mantine/core';
import { getChildLogger } from '../../../lib/logging/singleton.js';

// Lazy admin logger with session logging enabled
let _adminLog;
function adminLog(component) {
  if (!_adminLog) _adminLog = getChildLogger({ app: 'admin', sessionLog: true });
  return component ? _adminLog.child({ component }) : _adminLog;
}

// Shimmer Avatar - shows shimmer placeholder while image loads
export function ShimmerAvatar({ src, size = 36, radius = 'sm', color, children, onLoadEvent, ...props }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const log = useMemo(() => adminLog('ShimmerAvatar'), []);
  const loadStartRef = useRef(0);

  // Reset state when src changes
  useEffect(() => {
    setLoaded(false);
    setError(false);
  }, [src]);

  // Preload image
  useEffect(() => {
    if (!src) {
      setError(true);
      return;
    }
    loadStartRef.current = performance.now();
    log.debug('image.load.start', { src });
    const img = new Image();
    img.onload = () => {
      const durationMs = Math.round(performance.now() - loadStartRef.current);
      log.info('image.load.end', { src, durationMs });
      setLoaded(true);
      onLoadEvent?.({ ok: true, src, durationMs });
    };
    img.onerror = () => {
      const durationMs = Math.round(performance.now() - loadStartRef.current);
      log.warn('image.load.error', { src, durationMs });
      setError(true);
      onLoadEvent?.({ ok: false, src, durationMs });
    };
    img.src = src;
  }, [src, log, onLoadEvent]);

  // No src or error - show fallback avatar with optional color
  if (!src || error) {
    return (
      <Avatar size={size} radius={radius} color={color} {...props}>
        {children}
      </Avatar>
    );
  }

  // Still loading - show shimmer
  if (!loaded) {
    return (
      <div
        className="avatar-shimmer"
        data-shimmer-src={src}
        style={{
          width: size,
          height: size,
          minWidth: size,
          borderRadius: radius === 'sm' ? 4 : radius === 'md' ? 8 : radius
        }}
      />
    );
  }

  // Loaded - show actual avatar
  return (
    <Avatar src={src} size={size} radius={radius} {...props}>
      {children}
    </Avatar>
  );
}

export default ShimmerAvatar;
