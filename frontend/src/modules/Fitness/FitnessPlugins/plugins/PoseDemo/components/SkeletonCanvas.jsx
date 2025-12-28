/**
 * SkeletonCanvas - Canvas component for rendering pose skeleton
 * 
 * Draws keypoints and skeleton connections on a canvas overlay.
 */

import React, { useEffect, useRef, useCallback, useMemo } from 'react';
import { BLAZEPOSE_CONNECTIONS, SIMPLIFIED_CONNECTIONS, getBodyPart, isLeftSide, isRightSide } from '../../../../lib/pose/poseConnections.js';
import { getColorScheme, COLOR_SCHEMES } from '../../../../lib/pose/poseColors.js';
import { mirrorKeypoints, toHipCenteredCoordinates, fromHipCenteredCoordinates } from '../../../../lib/pose/poseGeometry.js';

const DEFAULT_OPTIONS = {
  showKeypoints: true,
  showSkeleton: true,
  showLabels: false,
  showSimplified: false,
  showGrid: true,
  colorScheme: 'rainbow',
  keypointRadius: 6,
  lineWidth: 3,
  confidenceThreshold: 0.3,
  mirrorHorizontal: true,
  backgroundColor: null, // null = transparent
  // Source dimensions (from video) - used to scale standalone skeleton
  sourceWidth: null,
  sourceHeight: null,
  // Display mode: 'overlay' positions directly on video, 'standalone' centers in canvas
  displayMode: 'overlay',
  // Hip-centered mode: anchors skeleton to hip, all points relative
  hipCentered: true,  // Margin for auto-scaling in hip-centered mode (0.1 = 10%)
  autoScaleMargin: 0.05,};

const SkeletonCanvas = ({
  poses = [],
  width,
  height,
  options = {},
  className = '',
  style = {},
}) => {
  const canvasRef = useRef(null);
  const animationFrameRef = useRef(null);
  
  // Merge options with defaults
  const opts = useMemo(() => ({
    ...DEFAULT_OPTIONS,
    ...options,
  }), [options]);
  
  // Get color scheme
  const colorScheme = useMemo(() => {
    return getColorScheme(opts.colorScheme);
  }, [opts.colorScheme]);
  
  // Get connections array
  const connections = useMemo(() => {
    return opts.showSimplified ? SIMPLIFIED_CONNECTIONS : BLAZEPOSE_CONNECTIONS;
  }, [opts.showSimplified]);
  
  /**
   * Clear the canvas
   */
  const clearCanvas = useCallback((ctx, w, h) => {
    if (opts.backgroundColor) {
      ctx.fillStyle = opts.backgroundColor;
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.clearRect(0, 0, w, h);
    }
  }, [opts.backgroundColor]);
  
  /**
   * Draw a single keypoint
   */
  const drawKeypoint = useCallback((ctx, keypoint, index) => {
    if (!keypoint || keypoint.score < opts.confidenceThreshold) return;
    
    const bodyPart = getBodyPart(index);
    const isLeft = isLeftSide(index);
    const isRight = isRightSide(index);
    const color = colorScheme.getPointColor(bodyPart, keypoint.score, isLeft, isRight);
    
    ctx.beginPath();
    ctx.arc(keypoint.x, keypoint.y, opts.keypointRadius, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    
    // Optional: draw confidence ring
    if (keypoint.score < 0.7) {
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }, [colorScheme, opts.keypointRadius, opts.confidenceThreshold]);
  
  /**
   * Draw a skeleton line between two keypoints
   */
  const drawConnection = useCallback((ctx, kp1, kp2, startIdx, endIdx) => {
    if (!kp1 || !kp2) return;
    if (kp1.score < opts.confidenceThreshold || kp2.score < opts.confidenceThreshold) return;
    
    const bodyPart1 = getBodyPart(startIdx);
    const bodyPart2 = getBodyPart(endIdx);
    // Use the body part that's more specific (not face if one is torso, etc.)
    const bodyPart = bodyPart1 === 'face' ? bodyPart2 : bodyPart1;
    
    const isLeft = isLeftSide(startIdx) || isLeftSide(endIdx);
    const isRight = isRightSide(startIdx) || isRightSide(endIdx);
    const avgConfidence = (kp1.score + kp2.score) / 2;
    
    const color = colorScheme.getLineColor(bodyPart, avgConfidence, isLeft, isRight);
    
    ctx.beginPath();
    ctx.moveTo(kp1.x, kp1.y);
    ctx.lineTo(kp2.x, kp2.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = opts.lineWidth;
    ctx.lineCap = 'round';
    ctx.stroke();
  }, [colorScheme, opts.lineWidth, opts.confidenceThreshold]);
  
  /**
   * Draw keypoint label
   */
  const drawLabel = useCallback((ctx, keypoint, index, name) => {
    if (!keypoint || keypoint.score < opts.confidenceThreshold) return;
    
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    
    const text = `${index}: ${name}`;
    const x = keypoint.x + opts.keypointRadius + 4;
    const y = keypoint.y + 3;
    
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
  }, [opts.confidenceThreshold, opts.keypointRadius]);

  /**
   * Draw debug grid and outline
   */
  const drawGrid = useCallback((ctx, w, h) => {
    if (!opts.showGrid) return;
    
    ctx.save();
    
    // Grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    const step = 40;
    
    ctx.beginPath();
    for (let x = step; x < w; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = step; y < h; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
    
    // Outline
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.3)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
    
    ctx.restore();
  }, [opts.showGrid]);

  /**
   * Calculate transform for standalone mode (centers and scales skeleton to fit canvas)
   */
  const calculateStandaloneTransform = useCallback((canvasW, canvasH) => {
    // Use source dimensions if provided, otherwise assume 1280x720
    const srcW = opts.sourceWidth || 1280;
    const srcH = opts.sourceHeight || 720;
    
    // Calculate scale to fit with padding
    const padding = 10;
    const availW = canvasW - (padding * 2);
    const availH = canvasH - (padding * 2);
    
    const scaleX = availW / srcW;
    const scaleY = availH / srcH;
    const scale = Math.min(scaleX, scaleY);
    
    // Calculate offset to center
    const scaledW = srcW * scale;
    const scaledH = srcH * scale;
    const offsetX = (canvasW - scaledW) / 2;
    const offsetY = (canvasH - scaledH) / 2;
    
    return { scale, offsetX, offsetY, scaledW, scaledH };
  }, [opts.sourceWidth, opts.sourceHeight]);
  
  /**
   * Draw a single pose
   */
  const drawPose = useCallback((ctx, pose, canvasWidth, canvasHeight, transform = null) => {
    if (!pose?.keypoints) return;
    
    let keypoints = pose.keypoints;
    
    // Mirror horizontally if needed (for webcam) - use source width for mirroring
    const mirrorWidth = transform ? (opts.sourceWidth || 1280) : canvasWidth;
    if (opts.mirrorHorizontal) {
      keypoints = mirrorKeypoints(keypoints, mirrorWidth);
    }
    
    // Apply hip-centered transformation if enabled
    let hipCenterInfo = null;
    if (opts.hipCentered) {
      const result = toHipCenteredCoordinates(keypoints);
      
      if (result.hipCenter) {
        hipCenterInfo = result;
        
        // Place hip at center of canvas (or transform area)
        const centerX = transform 
          ? transform.offsetX + transform.scaledW / 2 
          : canvasWidth / 2;
        const centerY = transform 
          ? transform.offsetY + transform.scaledH / 2 
          : canvasHeight / 2;
        
        // Auto-scale to fit body within safe zone (margins)
        let scale = 1;
        const margin = opts.autoScaleMargin ?? 0.1;
        
        // 1. Vertical Constraints
        const leftEye = result.keypoints[2];
        const rightEye = result.keypoints[5];
        const nose = result.keypoints[0];
        
        // Find head Y (top) relative to hip (0)
        let headY = null;
        if (leftEye && rightEye && leftEye.score > 0.3 && rightEye.score > 0.3) {
          headY = (leftEye.y + rightEye.y) / 2;
        } else if (nose && nose.score > 0.3) {
          headY = nose.y;
        }

        // Find feet Y (bottom) relative to hip (0)
        let feetY = null;
        const feetIndices = [27, 28, 29, 30, 31, 32]; // Ankles, Heels, Foot Indices
        let maxFeetY = -Infinity;
        
        feetIndices.forEach(idx => {
          const kp = result.keypoints[idx];
          if (kp && kp.score > 0.3) {
            if (kp.y > maxFeetY) maxFeetY = kp.y;
          }
        });
        
        if (maxFeetY > -Infinity) feetY = maxFeetY;
        
        // 2. Horizontal Constraints
        let minX = Infinity;
        let maxX = -Infinity;
        
        result.keypoints.forEach(kp => {
          if (kp && kp.score > 0.3) {
            if (kp.x < minX) minX = kp.x;
            if (kp.x > maxX) maxX = kp.x;
          }
        });

        // Calculate Scales
        let verticalScale = Infinity;
        let horizontalScale = Infinity;
        
        // Vertical calculation
        if (headY !== null) {
          const height = transform ? transform.scaledH : canvasHeight;
          const safeZoneH = height * (0.5 - margin);
          const headDist = Math.abs(headY);
          
          if (headDist > 20) {
             verticalScale = safeZoneH / headDist;
             
             if (feetY !== null && feetY > 20) {
               const feetDist = Math.abs(feetY);
               const feetScale = safeZoneH / feetDist;
               verticalScale = Math.min(verticalScale, feetScale);
             }
          }
        }
        
        // Horizontal calculation
        if (minX !== Infinity && maxX !== -Infinity) {
          const width = transform ? transform.scaledW : canvasWidth;
          const safeZoneW = width * (0.5 - margin);
          const maxDistX = Math.max(Math.abs(minX), Math.abs(maxX));
          
          if (maxDistX > 20) {
            horizontalScale = safeZoneW / maxDistX;
          }
        }
        
        // Apply minimum valid scale
        if (verticalScale !== Infinity || horizontalScale !== Infinity) {
           scale = Math.min(verticalScale, horizontalScale);
           // Sanity check to prevent explosion on single point
           if (scale > 5) scale = 5; 
        }

        // Apply scale
        const scaledKeypoints = result.keypoints.map(kp => ({
          ...kp,
          x: kp.x * scale,
          y: kp.y * scale,
          z: (kp.z || 0) * scale
        }));

        keypoints = fromHipCenteredCoordinates(
          scaledKeypoints, 
          { x: centerX, y: centerY, z: 0 }
        );
      }
    } else if (transform) {
      // Apply transform for standalone mode (non-hip-centered)
      keypoints = keypoints.map(kp => ({
        ...kp,
        x: (kp.x * transform.scale) + transform.offsetX,
        y: (kp.y * transform.scale) + transform.offsetY,
      }));
    }
    
    // Draw skeleton lines first (so keypoints appear on top)
    if (opts.showSkeleton) {
      connections.forEach(([startIdx, endIdx]) => {
        drawConnection(ctx, keypoints[startIdx], keypoints[endIdx], startIdx, endIdx);
      });
    }
    
    // Draw keypoints
    if (opts.showKeypoints) {
      keypoints.forEach((kp, idx) => {
        drawKeypoint(ctx, kp, idx);
      });
    }
    
    // Draw labels
    if (opts.showLabels) {
      const { KEYPOINT_NAMES } = require('../../../../lib/pose/poseConnections.js');
      keypoints.forEach((kp, idx) => {
        drawLabel(ctx, kp, idx, KEYPOINT_NAMES[idx]);
      });
    }
  }, [
    opts.mirrorHorizontal,
    opts.showSkeleton,
    opts.showKeypoints,
    opts.showLabels,
    opts.sourceWidth,
    opts.hipCentered,
    connections,
    drawConnection,
    drawKeypoint,
    drawLabel,
  ]);
  
  /**
   * Update canvas size when dimensions change
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    // Use provided dimensions or get from parent
    const w = width || canvas.parentElement?.clientWidth || 640;
    const h = height || canvas.parentElement?.clientHeight || 480;
    
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }, [width, height]);
  
  /**
   * Render on pose updates - triggered by pose changes, not continuous loop
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const w = canvas.width;
    const h = canvas.height;
    
    // Clear canvas
    clearCanvas(ctx, w, h);
    
    // Calculate transform for standalone mode
    const isStandalone = opts.displayMode === 'standalone';
    const transform = isStandalone ? calculateStandaloneTransform(w, h) : null;
    
    // Draw frame boundary for standalone mode
    if (isStandalone && transform) {
      ctx.save();
      ctx.strokeStyle = 'rgba(100, 100, 100, 0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(transform.offsetX, transform.offsetY, transform.scaledW, transform.scaledH);
      ctx.setLineDash([]);
      ctx.restore();
    }
    
    // Draw grid
    drawGrid(ctx, w, h);
    
    // Draw all poses
    if (poses && poses.length > 0) {
      poses.forEach(pose => {
        drawPose(ctx, pose, w, h, transform);
      });
    }
  }, [poses, clearCanvas, drawPose, drawGrid, opts.displayMode, calculateStandaloneTransform, width, height]);
  
  // Compute canvas style
  const canvasStyle = useMemo(() => ({
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    ...style,
  }), [style]);
  
  return (
    <canvas
      ref={canvasRef}
      className={`skeleton-canvas ${className}`}
      style={canvasStyle}
      width={width || 640}
      height={height || 480}
    />
  );
};

export default SkeletonCanvas;
