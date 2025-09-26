import React from 'react';
import { useFitnessWebSocket } from '../../hooks/useFitnessWebSocket.js';
import MiniMonitor from './MiniMonitor.jsx';
import './SidebarFooter.scss';

const SidebarFooter = ({ onContentSelect }) => {
  const { 
    connected, 
    allDevices,    heartRateDevices, 
    speedDevices,
    cadenceDevices,
    powerDevices,
    deviceCount
  } = useFitnessWebSocket();

  const activeDevices = allDevices.filter(device => device.isActive);
  const hasActiveDevices = activeDevices.length > 0;

  // Helper functions from FitnessUsers
  const getDeviceIcon = (device) => {
    if (device.heartRate !== undefined) return '❤️';
    if (device.power !== undefined) return '⚡';
    if (device.cadence !== undefined) return '⚙️';
    if (device.speedKmh !== undefined) return '🚴';
    return '📡';
  };

  const getDeviceValue = (device) => {
    if (device.heartRate) return `${device.heartRate}`;
    if (device.power) return `${device.power}`;
    if (device.cadence) return `${device.cadence}`;
    if (device.speedKmh) return `${device.speedKmh.toFixed(1)}`;
    return '--';
  };

  const getDeviceColor = (device) => {
    if (device.heartRate !== undefined) return 'heart-rate';
    if (device.power !== undefined) return 'power';
    if (device.cadence !== undefined) return 'cadence';
    if (device.speedKmh !== undefined) return 'speed';
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