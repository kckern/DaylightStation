/**
 * PoseControls - Control panel for pose detection settings
 */

import React, { useCallback } from 'react';
import { getAvailableSchemes, COLOR_SCHEMES } from '../../../../lib/pose/poseColors.js';

const DISPLAY_MODES = [
  { id: 'overlay', label: 'Overlay', icon: '🎭' },
  { id: 'side-by-side', label: 'Side by Side', icon: '⬜⬜' },
  { id: 'skeleton-only', label: 'Skeleton Only', icon: '🦴' },
];

const MODEL_TYPES = [
  { id: 'lite', label: 'Lite (Fast)', description: 'Lower accuracy, best performance' },
  { id: 'full', label: 'Full (Balanced)', description: 'Good accuracy and speed' },
  { id: 'heavy', label: 'Heavy (Accurate)', description: 'Highest accuracy, slower' },
];

const PoseControls = ({
  displayMode = 'overlay',
  onDisplayModeChange,
  renderOptions = {},
  onRenderOptionsChange,
  modelType = 'full',
  onModelTypeChange,
  isDetecting = false,
  onToggleDetection,
  isLoading = false,
  collapsed = false,
  onToggleCollapse,
}) => {
  const colorSchemes = getAvailableSchemes();
  
  const handleOptionChange = useCallback((key, value) => {
    onRenderOptionsChange?.({
      ...renderOptions,
      [key]: value,
    });
  }, [renderOptions, onRenderOptionsChange]);
  
  if (collapsed) {
    return (
      <div className="pose-controls collapsed">
        <button 
          className="toggle-btn"
          onClick={onToggleCollapse}
          title="Expand controls"
        >
          ⚙️
        </button>
      </div>
    );
  }
  
  return (
    <div className="pose-controls">
      <div className="controls-header">
        <span className="controls-title">Pose Settings</span>
        {onToggleCollapse && (
          <button className="collapse-btn" onClick={onToggleCollapse}>
            ✕
          </button>
        )}
      </div>
      
      {/* Detection Toggle */}
      <div className="control-group">
        <button
          className={`detection-toggle ${isDetecting ? 'active' : ''}`}
          onClick={onToggleDetection}
          disabled={isLoading}
        >
          {isLoading ? '⏳ Loading...' : isDetecting ? '⏸️ Pause' : '▶️ Start'}
        </button>
      </div>
      
      {/* Display Mode */}
      <div className="control-group">
        <label className="control-label">Display Mode</label>
        <div className="button-group">
          {DISPLAY_MODES.map(mode => (
            <button
              key={mode.id}
              className={`mode-btn ${displayMode === mode.id ? 'active' : ''}`}
              onClick={() => onDisplayModeChange?.(mode.id)}
              title={mode.label}
            >
              <span className="icon">{mode.icon}</span>
              <span className="label">{mode.label}</span>
            </button>
          ))}
        </div>
      </div>
      
      {/* Render Options */}
      <div className="control-group">
        <label className="control-label">Skeleton</label>
        <div className="toggle-row">
          <label className="toggle-option">
            <input
              type="checkbox"
              checked={renderOptions.showSkeleton !== false}
              onChange={e => handleOptionChange('showSkeleton', e.target.checked)}
            />
            <span>Lines</span>
          </label>
          <label className="toggle-option">
            <input
              type="checkbox"
              checked={renderOptions.showKeypoints !== false}
              onChange={e => handleOptionChange('showKeypoints', e.target.checked)}
            />
            <span>Points</span>
          </label>
          <label className="toggle-option">
            <input
              type="checkbox"
              checked={renderOptions.showLabels === true}
              onChange={e => handleOptionChange('showLabels', e.target.checked)}
            />
            <span>Labels</span>
          </label>
        </div>
        <div className="toggle-row">
          <label className="toggle-option">
            <input
              type="checkbox"
              checked={renderOptions.showSimplified === true}
              onChange={e => handleOptionChange('showSimplified', e.target.checked)}
            />
            <span>Simplified</span>
          </label>
          <label className="toggle-option">
            <input
              type="checkbox"
              checked={renderOptions.showInspector === true}
              onChange={e => handleOptionChange('showInspector', e.target.checked)}
            />
            <span>Inspector</span>
          </label>
        </div>
      </div>
      
      {/* Color Scheme */}
      <div className="control-group">
        <label className="control-label">Color Scheme</label>
        <select
          value={renderOptions.colorScheme || 'rainbow'}
          onChange={e => handleOptionChange('colorScheme', e.target.value)}
          className="color-select"
        >
          {colorSchemes.map(scheme => (
            <option key={scheme} value={scheme}>
              {COLOR_SCHEMES[scheme]?.name || scheme}
            </option>
          ))}
        </select>
      </div>
      
      {/* Model Type */}
      <div className="control-group">
        <label className="control-label">Model</label>
        <select
          value={modelType}
          onChange={e => onModelTypeChange?.(e.target.value)}
          className="model-select"
          disabled={isDetecting}
          title={isDetecting ? 'Stop detection to change model' : ''}
        >
          {MODEL_TYPES.map(type => (
            <option key={type.id} value={type.id}>
              {type.label}
            </option>
          ))}
        </select>
        {isDetecting && (
          <span className="hint">Stop to change model</span>
        )}
      </div>
      
      {/* Confidence Threshold */}
      <div className="control-group">
        <label className="control-label">
          Min Confidence: {Math.round((renderOptions.confidenceThreshold || 0.3) * 100)}%
        </label>
        <input
          type="range"
          min="0.1"
          max="0.9"
          step="0.1"
          value={renderOptions.confidenceThreshold || 0.3}
          onChange={e => handleOptionChange('confidenceThreshold', parseFloat(e.target.value))}
          className="confidence-slider"
        />
      </div>
    </div>
  );
};

export default PoseControls;
