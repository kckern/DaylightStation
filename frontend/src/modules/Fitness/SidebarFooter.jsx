import React, { useState, useEffect, useRef } from 'react';
import { useFitnessContext } from '../../context/FitnessContext.jsx';
import FlipMove from 'react-flip-move';
import MiniMonitor from './MiniMonitor.jsx';
import './SidebarFooter.scss';

const SidebarFooter = ({ onContentSelect }) => {
  const { 
    connected, 
    allDevices,
    heartRateDevices, 
    speedDevices,
    cadenceDevices,
    powerDevices,
    deviceCount,
    deviceConfiguration
  } = useFitnessContext();
  
  // State for sorted devices
  const [sortedDevices, setSortedDevices] = useState([]);

  // Sort devices whenever allDevices changes
  useEffect(() => {
    const hrDevices = allDevices.filter(d => d.type === 'heart_rate');
    const otherDevices = allDevices.filter(d => d.type !== 'heart_rate');

    // First by active status, then by heart rate
    hrDevices.sort((a, b) => {
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;
      return (b.heartRate || 0) - (a.heartRate || 0);
    });
    
    // Sort other devices
    otherDevices.sort((a, b) => {
      const typeOrder = { power: 1, cadence: 2, speed: 3, unknown: 4 };
      const typeA = typeOrder[a.type] || 4;
      const typeB = typeOrder[b.type] || 4;
      if (typeA !== typeB) return typeA - typeB;
      
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;
      
      const valueA = a.power || a.cadence || (a.speedKmh || 0);
      const valueB = b.power || b.cadence || (b.speedKmh || 0);
      return valueB - valueA;
    });
    
    // Update the sorted devices
    setSortedDevices([...hrDevices, ...otherDevices]);
  }, [allDevices]);

  // Heart rate device color mapping
  const hrColorMap = {
    "28812": "red",
    "28688": "yellow", 
    "28676": "green",
    "29413": "blue",
    "40475": "watch"
  };

  // Helper functions
  const getDeviceIcon = (device) => {
    if (device.type === 'heart_rate') {
      const colorKey = hrColorMap[String(device.deviceId)];
      if (!colorKey) return '🧡'; // Default orange
      
      const colorIcons = {
        red: '❤️',     // Red heart
        yellow: '💛',  // Yellow heart
        green: '💚',   // Green heart
        blue: '💙',    // Blue heart
        watch: '🤍'    // White heart (for watch)
      };
      
      return colorIcons[colorKey] || '🧡';
    }
    if (device.type === 'power') return '⚡';
    if (device.type === 'cadence') return '⚙️';
    if (device.type === 'speed') return '🚴';
    return '';
  };

  const getDeviceValue = (device) => {
    if (device.type === 'heart_rate' && device.heartRate) return `${device.heartRate}`;
    if (device.type === 'power' && device.power) return `${device.power}`;
    if (device.type === 'cadence' && device.cadence) return `${device.cadence}`;
    if (device.type === 'speed' && device.speedKmh) return `${device.speedKmh.toFixed(1)}`;
    return '--';
  };

  const getDeviceColor = (device) => {
    if (device.type === 'heart_rate') return 'heart-rate';
    if (device.type === 'power') return 'power';
    if (device.type === 'cadence') return 'cadence';
    if (device.type === 'speed') return 'speed';
    return 'unknown';
  };

  return (
    <div className="sidebar-footer">
      <FlipMove 
        className="device-container" 
        duration={300} 
        easing="ease-out"
        staggerDelayBy={20}
        enterAnimation="fade"
        leaveAnimation="fade"
        maintainContainerHeight={true}
        typeName="div"
      >
        {sortedDevices.map((device) => {
          const deviceId = String(device.deviceId);
          const deviceValue = getDeviceValue(device);
          
          return (
            <div
              key={deviceId}
              className={`device-card ${getDeviceColor(device)} ${device.isActive ? 'active' : 'inactive'}`}
              onPointerDown={() => onContentSelect && onContentSelect('users')}
            >
              <div className="device-header">
                <div className="device-value">{deviceValue}</div>
              </div>
              <div className="device-icon">
                <span className="icon-main">{getDeviceIcon(device)}</span>
              </div>
            </div>
          );
        })}
      </FlipMove>
      
      {sortedDevices.length === 0 && (
        <div
          className={`device-card fitness-monitor ${connected ? 'connected' : 'disconnected'}`}
          onPointerDown={() => onContentSelect && onContentSelect('users')}
        >
          <div className="device-icon">❤️</div>
          <div className="connection-status">
            <div className={`status-dot ${connected ? 'connected' : 'disconnected'}`}></div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SidebarFooter;