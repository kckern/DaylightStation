import React, { useRef, useEffect, useImperativeHandle, forwardRef, useState } from 'react';
import PropTypes from 'prop-types';
import useResponsiveSize from '../../hooks/useResponsiveSize';
import './GameCanvas.scss';

const GameCanvas = forwardRef(({
  width,
  height,
  aspectRatio = '16:9',
  onFrame,
  onResize,
  fps = 60,
  autoStart = true,
  pixelRatio = 'auto',
  enableTouch = true,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  overlayContent,
  className,
  ...props
}, ref) => {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const requestRef = useRef(null);
  const previousTimeRef = useRef(null);
  const frameCountRef = useRef(0);
  const [isRunning, setIsRunning] = useState(autoStart);
  
  // Use our responsive size hook for the container
  const { width: containerWidth, height: containerHeight } = useResponsiveSize({
    onResize: (size) => {
      // Handle canvas resize logic
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      const dpr = pixelRatio === 'auto' ? window.devicePixelRatio || 1 : pixelRatio;
      
      // Calculate dimensions based on aspect ratio if not explicit
      let targetWidth = size.width;
      let targetHeight = size.height;
      
      if (aspectRatio && (!width || !height)) {
        const [w, h] = aspectRatio.split(':').map(Number);
        const ratio = w / h;
        
        // Fit within container while maintaining aspect ratio
        if (size.width / size.height > ratio) {
          targetHeight = size.height;
          targetWidth = targetHeight * ratio;
        } else {
          targetWidth = size.width;
          targetHeight = targetWidth / ratio;
        }
      }

      canvas.width = targetWidth * dpr;
      canvas.height = targetHeight * dpr;
      
      canvas.style.width = `${targetWidth}px`;
      canvas.style.height = `${targetHeight}px`;
      
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      
      onResize?.(targetWidth, targetHeight);
    }
  });

  const animate = (time) => {
    if (previousTimeRef.current !== undefined) {
      const deltaTime = time - previousTimeRef.current;
      
      // Cap max delta time to prevent huge jumps (e.g. tab switching)
      const cappedDelta = Math.min(deltaTime, 100);
      
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx && onFrame) {
        onFrame(ctx, cappedDelta, frameCountRef.current);
      }
      
      frameCountRef.current++;
    }
    previousTimeRef.current = time;
    requestRef.current = requestAnimationFrame(animate);
  };

  useEffect(() => {
    if (isRunning) {
      requestRef.current = requestAnimationFrame(animate);
    } else {
      cancelAnimationFrame(requestRef.current);
      previousTimeRef.current = undefined;
    }
    return () => cancelAnimationFrame(requestRef.current);
  }, [isRunning, onFrame]);

  useImperativeHandle(ref, () => ({
    start: () => setIsRunning(true),
    stop: () => setIsRunning(false),
    getContext: () => canvasRef.current?.getContext('2d'),
    getCanvas: () => canvasRef.current,
    captureFrame: () => canvasRef.current?.toDataURL()
  }));

  // Event handlers
  const handleTouchStart = (e) => {
    if (!enableTouch) return;
    e.preventDefault(); // Prevent scrolling
    onTouchStart?.(e);
  };

  return (
    <div 
      className={`game-canvas-container ${className || ''}`} 
      ref={containerRef}
      {...props}
    >
      <canvas
        ref={canvasRef}
        className="game-canvas"
        onTouchStart={handleTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      {overlayContent && (
        <div className="game-canvas-overlay">
          {overlayContent}
        </div>
      )}
    </div>
  );
});

GameCanvas.propTypes = {
  width: PropTypes.number,
  height: PropTypes.number,
  aspectRatio: PropTypes.string,
  onFrame: PropTypes.func,
  onResize: PropTypes.func,
  fps: PropTypes.number,
  autoStart: PropTypes.bool,
  pixelRatio: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  enableTouch: PropTypes.bool,
  onTouchStart: PropTypes.func,
  onTouchMove: PropTypes.func,
  onTouchEnd: PropTypes.func,
  onPointerDown: PropTypes.func,
  onPointerMove: PropTypes.func,
  onPointerUp: PropTypes.func,
  overlayContent: PropTypes.node,
  className: PropTypes.string
};

export default GameCanvas;
