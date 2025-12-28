/**
 * ConfidenceMeter - Visual indicator for pose detection quality
 * 
 * Displays a progress bar showing overall pose confidence (0-100%).
 * Color-coded to indicate quality level and shows threshold warning.
 */

import React, { useMemo } from 'react';
import { getConfidenceColor, getConfidenceLabel } from '../../../../lib/pose/poseConfidence.js';
import './ConfidenceMeter.scss';

const ConfidenceMeter = ({
  confidence = 0,
  threshold = 40,
  showLabel = true,
  showStatus = false,
  showThresholdWarning = true,
  position = 'top-right',
  animated = true,
  compact = false,
  className = '',
}) => {
  // Clamp confidence to 0-100
  const clampedConfidence = useMemo(() => 
    Math.max(0, Math.min(100, confidence)),
  [confidence]);
  
  // Get color based on confidence level
  const color = useMemo(() => 
    getConfidenceColor(clampedConfidence),
  [clampedConfidence]);
  
  // Get status label
  const statusLabel = useMemo(() => 
    getConfidenceLabel(clampedConfidence),
  [clampedConfidence]);
  
  // Check if below threshold
  const isBelowThreshold = clampedConfidence < threshold && threshold > 0;
  
  // Format percentage
  const percentageText = useMemo(() => 
    `${Math.round(clampedConfidence)}%`,
  [clampedConfidence]);
  
  // Build class names
  const containerClasses = useMemo(() => {
    const classes = ['confidence-meter', `position-${position}`];
    if (animated) classes.push('animated');
    if (compact) classes.push('compact');
    if (isBelowThreshold) classes.push('below-threshold');
    if (clampedConfidence === 0) classes.push('no-detection');
    if (className) classes.push(className);
    return classes.join(' ');
  }, [position, animated, compact, isBelowThreshold, clampedConfidence, className]);

  if (compact) {
    return (
      <div className={containerClasses}>
        <div 
          className="meter-bar-compact"
          style={{ '--confidence': `${clampedConfidence}%`, '--color': color }}
        >
          <div className="fill" />
        </div>
        {showLabel && (
          <span className="label" style={{ color }}>
            {percentageText}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={containerClasses}>
      <div className="meter-container">
        <div 
          className="meter-bar"
          style={{ '--confidence': `${clampedConfidence}%`, '--color': color }}
        >
          <div className="track" />
          <div className="fill" />
          {threshold > 0 && (
            <div 
              className="threshold-marker"
              style={{ '--threshold': `${threshold}%` }}
            />
          )}
        </div>
        
        <div className="meter-info">
          {showLabel && (
            <span className="percentage" style={{ color }}>
              {percentageText}
            </span>
          )}
          {showStatus && (
            <span className="status" style={{ color }}>
              {statusLabel}
            </span>
          )}
        </div>
      </div>
      
      {showThresholdWarning && isBelowThreshold && (
        <div className="threshold-warning">
          <span className="warning-icon">⚠</span>
          <span className="warning-text">Low confidence</span>
        </div>
      )}
    </div>
  );
};

export default ConfidenceMeter;
