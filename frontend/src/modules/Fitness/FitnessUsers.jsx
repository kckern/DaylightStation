import React, { useState, useEffect } from 'react';
import { Group, Text, Badge, Stack } from '@mantine/core';
import { useFitnessContext } from '../../context/FitnessContext.jsx';
import FlipMove from 'react-flip-move';
import './FitnessUsers.scss';
import { DaylightMediaPath } from '../../lib/api.mjs';

const FitnessUsers = () => {
  // Use the fitness context
  const { 
    connected, 
    allDevices,
    heartRateDevices, 
    speedDevices,
    cadenceDevices,
    powerDevices,
    unknownDevices,
    deviceCount, 
    latestData, 
    lastUpdate,
    deviceConfiguration
  } = useFitnessContext();
  
  // State for sorted devices
  const [sortedDevices, setSortedDevices] = useState([]);

  // Build lookup maps for heart rate device colors and user assignments
  // Use a hardcoded fallback for color mapping if all else fails
  const hardcodedColorMap = {
    "28812": "red",
    "28688": "yellow", 
    "28676": "green",
    "29413": "blue",
    "40475": "watch"
  };
  
  // Hardcoded name mapping for each heart rate device
  const hardcodedNameMap = {
    "28812": "Felix",
    "28688": "Milo", 
    "28676": "Alan",
    "29413": "Soren",
    "40475": "Dad"
  };
  
  const rawHrColorMap = (deviceConfiguration?.hr) || 
                       hardcodedColorMap;
  
  // Ensure all keys are strings for consistent lookup
  const hrColorMap = React.useMemo(() => {
    const map = {};
    if (rawHrColorMap && typeof rawHrColorMap === 'object') {
      Object.keys(rawHrColorMap).forEach(key => {
        map[String(key)] = rawHrColorMap[key];
      });
    }
    return map;
  }, [rawHrColorMap]);
  
  // Get users directly from the context
  const { primaryUsers = [], secondaryUsers = [] } = useFitnessContext();

  // Map of deviceId -> user name (first match wins from primary then secondary)
  const hrOwnerMap = React.useMemo(() => {
    const map = {};
    [...primaryUsers, ...secondaryUsers].forEach(u => {
      if (u?.hr !== undefined && u?.hr !== null) {
        map[String(u.hr)] = u.name;
      }
    });
    return map;
  }, [primaryUsers, secondaryUsers]);

  const heartColorIcon = (deviceId) => {
    const deviceIdStr = String(deviceId);
    const colorKey = hrColorMap[deviceIdStr];
    
    if (!colorKey) {
      return '🧡'; // Default to orange if not found
    }
    
    // Map color key to colored heart emojis
    const colorIcons = {
      red: '❤️',     // Red heart
      yellow: '💛',  // Yellow heart
      green: '💚',   // Green heart
      blue: '💙',    // Blue heart
      watch: '🤍'    // White heart (for watch)
    };
    
    const icon = colorIcons[colorKey] || '🧡';
    return icon;
  };

  // Format time ago helper
  const formatTimeAgo = (timestamp) => {
    if (!timestamp) return 'Never';
    const seconds = Math.floor((new Date() - timestamp) / 1000);
    if (seconds < 10) return 'Just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  const getDeviceIcon = (device) => {
    if (device.type === 'heart_rate') {
      return heartColorIcon(device.deviceId);
    }
    if (device.type === 'power') return '⚡';
    if (device.type === 'cadence') return '⚙️';
    if (device.type === 'speed') return '🚴';
    return '📡';
  };

  const getDeviceValue = (device) => {
    if (device.type === 'heart_rate' && device.heartRate) return `${device.heartRate}`;
    if (device.type === 'power' && device.power) return `${device.power}`;
    if (device.type === 'cadence' && device.cadence) return `${device.cadence}`;
    if (device.type === 'speed' && device.speedKmh) return `${device.speedKmh.toFixed(1)}`;
    return '--';
  };

  const getDeviceUnit = (device) => {
    if (device.type === 'heart_rate') return 'BPM';
    if (device.type === 'power') return 'W';
    if (device.type === 'cadence') return 'RPM';
    if (device.type === 'speed') return 'km/h';
    return '';
  };

  const getDeviceColor = (device) => {
    if (device.type === 'heart_rate') return 'heart-rate';
    if (device.type === 'power') return 'power';
    if (device.type === 'cadence') return 'cadence';
    if (device.type === 'speed') return 'speed';
    return 'unknown';
  };
  
  // Sort devices whenever allDevices changes
  useEffect(() => {
    // First prioritize heart rate monitors
    const hrDevices = allDevices.filter(d => d.type === 'heart_rate');
    const otherDevices = allDevices.filter(d => d.type !== 'heart_rate');
    
    // Sort heart rate devices by value
    hrDevices.sort((a, b) => {
      // First by active status
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;
      
      // Then by heart rate value (higher first)
      return (b.heartRate || 0) - (a.heartRate || 0);
    });
    
    // Sort other devices by type then value
    otherDevices.sort((a, b) => {
      // First by device type
      const typeOrder = { power: 1, cadence: 2, speed: 3, unknown: 4 };
      const typeA = typeOrder[a.type] || 4;
      const typeB = typeOrder[b.type] || 4;
      if (typeA !== typeB) return typeA - typeB;
      
      // Then by active status
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;
      
      // Then by value
      const valueA = a.power || a.cadence || (a.speedKmh || 0);
      const valueB = b.power || b.cadence || (b.speedKmh || 0);
      return valueB - valueA;
    });
    
    // Combine sorted arrays
    setSortedDevices([...hrDevices, ...otherDevices]);
  }, [allDevices]);

  return (
    <div className="fitness-devices-nav">
      {/* Connection Status Header */}
      <div className="nav-header">
        <Text size="sm" fw={600} c="white">Fitness Devices</Text>
        <div className={`connection-indicator ${connected ? 'connected' : 'disconnected'}`}></div>
      </div>
      
      {/* Fitness Devices as Nav Icons */}
      <div className="fitness-devices">
        {sortedDevices.length > 0 ? (
          <FlipMove 
            className="device-grid"
            duration={300}
            easing="ease-out"
            staggerDelayBy={20}
            enterAnimation="fade"
            leaveAnimation="fade"
            maintainContainerHeight={true}
          >
            {sortedDevices.map((device) => {
              const ownerName = device.type === 'heart_rate' ? hrOwnerMap[String(device.deviceId)] : null;
              // Get name from hardcoded map for HR devices
              const deviceName = device.type === 'heart_rate' ? 
                hardcodedNameMap[String(device.deviceId)] || String(device.deviceId) : 
                String(device.deviceId);
                
              return (
                <div 
                  key={`device-${device.deviceId}`} 
                  className={`fitness-device card-horizontal ${getDeviceColor(device)} ${device.isActive ? 'active' : 'inactive'}`}
                  title={`Device: ${deviceName} (${device.deviceId}) - ${formatTimeAgo(device.lastSeen)}`}
                >
                  <div className="user-profile-img-container">
                    <img src={DaylightMediaPath(`/media/img/users/${ownerName || 'user'}.png`)} alt={`${ownerName || 'user'} profile`} />
                  </div>
                  <div className="device-info">
                    <div className="device-name">
                      {deviceName}
                    </div>
                    <div className="device-stats">
                      <span className="device-icon">{getDeviceIcon(device)}</span>
                      <span className="device-value">{getDeviceValue(device)}</span>
                      <span className="device-unit">{getDeviceUnit(device)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </FlipMove>
        ) : (
          <div className="nav-empty">
            <div className="empty-icon">📡</div>
            <Text size="xs" c="dimmed" ta="center">
              No devices
            </Text>
          </div>
        )}
      </div>
    </div>
  );
};

export default FitnessUsers;
