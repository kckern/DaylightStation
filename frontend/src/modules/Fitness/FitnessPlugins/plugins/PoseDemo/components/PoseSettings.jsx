import React, { useCallback } from 'react';
import { getAvailableSchemes } from '../../../../lib/pose/poseColors.js';

const MODEL_TYPES = [
  { id: 'lite', label: 'Lite', description: 'Fastest' },
  { id: 'full', label: 'Full', description: 'Balanced' },
  { id: 'heavy', label: 'Heavy', description: 'Accurate' },
];

const RESOLUTIONS = [
  { id: '240p', label: '240p' },
  { id: '480p', label: '480p' },
  { id: '720p', label: '720p' },
  { id: '1080p', label: '1080p' },
];

const BACKENDS = [
  { id: 'webgl', label: 'WebGL' },
  { id: 'wasm', label: 'WASM' },
  { id: 'cpu', label: 'CPU' },
];

const PoseSettings = ({
  isOpen,
  onClose,
  renderOptions = {},
  onRenderOptionsChange,
  modelType,
  onModelTypeChange,
  resolution,
  onResolutionChange,
  backend,
  onBackendChange,
  poseConfig = {},
  onPoseConfigChange,
  showPip,
  onTogglePip,
}) => {
  const colorSchemes = getAvailableSchemes();
  
  const handleRenderOptionChange = useCallback((key, value) => {
    onRenderOptionsChange?.({
      ...renderOptions,
      [key]: value,
    });
  }, [renderOptions, onRenderOptionsChange]);

  const handlePoseConfigChange = useCallback((key, value) => {
    onPoseConfigChange?.({
      [key]: value,
    });
  }, [onPoseConfigChange]);
  
  if (!isOpen) return null;
  
  return (
    <div className="pose-settings-overlay">
      <div className="pose-settings-panel">
        <div className="settings-header">
          <h3>Settings</h3>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>
        
        <div className="settings-content">
          {/* System Performance */}
          <section className="settings-section">
            <h4>Performance</h4>
            
            <div className="setting-row">
              <label>Model</label>
              <div className="button-group">
                {MODEL_TYPES.map(m => (
                  <button
                    key={m.id}
                    className={modelType === m.id ? 'active' : ''}
                    onClick={() => onModelTypeChange(m.id)}
                    title={m.description}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="setting-row">
              <label>Backend</label>
              <div className="button-group">
                {BACKENDS.map(b => (
                  <button
                    key={b.id}
                    className={backend === b.id ? 'active' : ''}
                    onClick={() => onBackendChange(b.id)}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="setting-row">
              <label>Resolution</label>
              <div className="button-group">
                {RESOLUTIONS.map(r => (
                  <button
                    key={r.id}
                    className={resolution === r.id ? 'active' : ''}
                    onClick={() => onResolutionChange(r.id)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Smoothing / Jitter */}
          <section className="settings-section">
            <h4>Smoothing</h4>
            
            <div className="setting-row checkbox-row">
              <label>
                <input
                  type="checkbox"
                  checked={poseConfig.temporalSmoothing !== false}
                  onChange={e => handlePoseConfigChange('temporalSmoothing', e.target.checked)}
                />
                Enable Temporal Smoothing
              </label>
            </div>

            {poseConfig.temporalSmoothing !== false && (
              <>
                <div className="setting-row range-row">
                  <label>Smoothing Factor ({poseConfig.smoothingFactor ?? 0.3})</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={poseConfig.smoothingFactor ?? 0.3}
                    onChange={e => handlePoseConfigChange('smoothingFactor', parseFloat(e.target.value))}
                  />
                </div>
                <div className="setting-row range-row">
                  <label>Velocity Damping ({poseConfig.velocityDamping ?? 0.3})</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={poseConfig.velocityDamping ?? 0.3}
                    onChange={e => handlePoseConfigChange('velocityDamping', parseFloat(e.target.value))}
                  />
                </div>
              </>
            )}
          </section>

          {/* Visualization */}
          <section className="settings-section">
            <h4>Visualization</h4>
            
            <div className="setting-row checkbox-row">
              <label>
                <input
                  type="checkbox"
                  checked={showPip}
                  onChange={e => onTogglePip(e.target.checked)}
                />
                Show Camera (PIP)
              </label>
            </div>

            <div className="setting-row">
              <label>Color Scheme</label>
              <select 
                value={renderOptions.colorScheme || 'rainbow'}
                onChange={e => handleRenderOptionChange('colorScheme', e.target.value)}
              >
                {colorSchemes.map(schemeId => (
                  <option key={schemeId} value={schemeId}>{schemeId}</option>
                ))}
              </select>
            </div>

            <div className="setting-row checkbox-grid">
              <label>
                <input
                  type="checkbox"
                  checked={renderOptions.hipCentered === true}
                  onChange={e => handleRenderOptionChange('hipCentered', e.target.checked)}
                />
                Hip Centered
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={renderOptions.showSkeleton !== false}
                  onChange={e => handleRenderOptionChange('showSkeleton', e.target.checked)}
                />
                Skeleton
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={renderOptions.showKeypoints !== false}
                  onChange={e => handleRenderOptionChange('showKeypoints', e.target.checked)}
                />
                Keypoints
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={renderOptions.showLabels === true}
                  onChange={e => handleRenderOptionChange('showLabels', e.target.checked)}
                />
                Labels
              </label>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default PoseSettings;
