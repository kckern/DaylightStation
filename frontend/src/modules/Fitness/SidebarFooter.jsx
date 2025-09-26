import React from 'react';
import { useFitnessWebSocket } from '../../hooks/useFitnessWebSocket.js';
import MiniMonitor from './MiniMonitor.jsx';
import './SidebarFooter.scss';

const SidebarFooter = ({ onContentSelect, fitnessConfiguration }) => {
  const { 
    connected, 
    allDevices,    heartRateDevices, 
    speedDevices,
    cadenceDevices,
    powerDevices,
    deviceCount
  } = useFitnessWebSocket(fitnessConfiguration);

  const activeDevices = allDevices.filter(device => device.isActive);
  const hasActiveDevices = activeDevices.length > 0;

  // Helper functions from FitnessUsers
  const getDeviceIcon = (device) => {
    if (device.heartRate !== undefined) return '❤️';
    if (device.power !== undefined) return '⚡';
    if (device.cadence !== undefined) return '⚙️';
    // Treat former speed devices as RPM-only wheel sensors; use wheel icon when RPM present, else generic
    if (device.type === 'speed') {
      if (device.wheelRpm || device.instantRpm || device.smoothedRpm) return '🛞';
      return '🛞'; // keep wheel even if zero to avoid cyclist icon
    }
    return '📡';
  };

  const getDeviceValue = (device) => {
    // Heart rate first
    if (device.heartRate) return `${device.heartRate}`;
    // Power
    if (device.power) return `${device.power}`;
    // Cadence
    if (device.cadence) return `${device.cadence}`;
    // Wheel RPM (new) before speed, prefer smoothed then instant
    if (device.type === 'speed') {
      const rpm = device.wheelRpm || device.smoothedRpm || device.instantRpm;
      if (rpm) return `${Math.round(rpm)}`;
    }
    // Former speed (suppressed) intentionally ignored; RPM-only mode
    return '--';
  };

  const getDeviceColor = (device) => {
    if (device.heartRate !== undefined) return 'heart-rate';
    if (device.power !== undefined) return 'power';
    if (device.cadence !== undefined) return 'cadence';
    if (device.type === 'speed') return 'rpm';
    return 'unknown';
  };

  return (
    <div className="sidebar-footer">
      {/* Show individual device icons if we have devices */}
      {allDevices.length > 0 ? (
        allDevices.map((device) => (
          <div 
            key={`footer-device-${device.deviceId}`} 
            className={`nav-item device-item ${getDeviceColor(device)} ${device.isActive ? 'active' : 'inactive'}`}
            onClick={() => onContentSelect && onContentSelect('users')}
            title={`${getDeviceIcon(device)} Device ${device.deviceId} - ${getDeviceValue(device)}`}
          >
            <div className="device-header">
              <div className="device-value">{getDeviceValue(device)}</div>
            </div>
            <div className="device-icon">
              <div className="icon-main">{getDeviceIcon(device)}</div>
            </div>
          </div>
        ))
      ) : (
        /* Fallback when no devices */
        <div
          className={`nav-item fitness-monitor ${connected ? 'connected' : 'disconnected'}`}
          onClick={() => onContentSelect && onContentSelect('users')}
          title={`Fitness Devices ${connected ? '(Connected)' : '(Disconnected)'}`}
        >
          <div className="nav-icon">
            <div className="icon-main">❤️</div>
          </div>
          
          <div className="nav-content">
            <div className="connection-status">
              <div className={`status-dot ${connected ? 'connected' : 'disconnected'}`}></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SidebarFooter;