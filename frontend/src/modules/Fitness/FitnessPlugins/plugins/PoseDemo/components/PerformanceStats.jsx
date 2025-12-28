/**
 * PerformanceStats - Display real-time pose detection performance metrics
 */

import React, { useMemo } from 'react';

const PerformanceStats = ({
  fps = 0,
  latency = 0,
  backend = null,
  modelType = 'full',
  isLoading = false,
  isDetecting = false,
  error = null,
  hasPose = false,
  compact = false,
}) => {
  // Determine status indicator
  const status = useMemo(() => {
    if (error) return { color: '#ff6b6b', label: 'Error', icon: '❌' };
    if (isLoading) return { color: '#ffd43b', label: 'Loading', icon: '⏳' };
    if (!isDetecting) return { color: '#868e96', label: 'Paused', icon: '⏸️' };
    if (!hasPose) return { color: '#ffa94d', label: 'No Pose', icon: '👤' };
    if (fps >= 25) return { color: '#69db7c', label: 'Excellent', icon: '✓' };
    if (fps >= 15) return { color: '#ffd43b', label: 'Good', icon: '✓' };
    return { color: '#ff8787', label: 'Slow', icon: '⚠️' };
  }, [error, isLoading, isDetecting, hasPose, fps]);
  
  // Format latency
  const latencyDisplay = useMemo(() => {
    if (latency === 0) return '--';
    return `${latency}ms`;
  }, [latency]);
  
  // Backend display name
  const backendDisplay = useMemo(() => {
    if (!backend) return '--';
    const names = {
      webgl: 'WebGL',
      wasm: 'WASM',
      cpu: 'CPU',
      webgpu: 'WebGPU',
    };
    return names[backend] || backend;
  }, [backend]);
  
  if (compact) {
    return (
      <div className="performance-stats compact">
        <span 
          className="status-indicator" 
          style={{ backgroundColor: status.color }}
          title={status.label}
        />
        <span className="fps-value">{fps} FPS</span>
      </div>
    );
  }
  
  return (
    <div className="performance-stats">
      {/* Status Row */}
      <div className="stat-row status-row">
        <span 
          className="status-indicator" 
          style={{ backgroundColor: status.color }}
        />
        <span className="status-label">{status.icon} {status.label}</span>
      </div>
      
      {/* Error Message */}
      {error && (
        <div className="error-message">
          {error.message || 'Detection error'}
        </div>
      )}
      
      {/* Stats Grid */}
      <div className="stats-grid">
        <div className="stat-item">
          <span className="stat-label">FPS</span>
          <span className="stat-value fps" data-quality={fps >= 25 ? 'good' : fps >= 15 ? 'ok' : 'poor'}>
            {fps}
          </span>
        </div>
        
        <div className="stat-item">
          <span className="stat-label">Latency</span>
          <span className="stat-value">{latencyDisplay}</span>
        </div>
        
        <div className="stat-item">
          <span className="stat-label">Backend</span>
          <span className="stat-value backend">{backendDisplay}</span>
        </div>
        
        <div className="stat-item">
          <span className="stat-label">Model</span>
          <span className="stat-value model">{modelType}</span>
        </div>
      </div>
    </div>
  );
};

export default PerformanceStats;
