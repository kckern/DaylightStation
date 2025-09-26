import React, { useState, useEffect } from 'react';
import { Group, Text, Badge, Stack } from '@mantine/core';
import { useFitnessWebSocket } from '../../hooks/useFitnessWebSocket.js';
import './FitnessUsers.scss';

const FitnessUsers = () => {
  // Use the fitness-specific WebSocket hook
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
    lastUpdate 
  } = useFitnessWebSocket();

  // Debug logging
  useEffect(() => {
    console.log(`🎯 FitnessUsers: ${deviceCount} devices, connected: ${connected}`);
    console.log('🎯 ALL DEVICES LENGTH:', allDevices.length);
    console.log('🎯 ALL DEVICES RAW:', allDevices);
    console.log('🎯 ALL DEVICES:', allDevices.map(d => `${d.deviceId}:${d.type}:${d.isActive ? 'active' : 'inactive'}`));
    console.log('🎯 HR devices:', heartRateDevices.map(d => d.deviceId));
    console.log('🎯 Speed devices:', speedDevices.map(d => d.deviceId));
    console.log('🎯 Cadence devices:', cadenceDevices.map(d => d.deviceId));
    console.log('🎯 Power devices:', powerDevices.map(d => d.deviceId));
    
    // Check if the hook is actually returning data
    console.log('🎯 Hook return values:', {
      connected,
      deviceCount,
      allDevicesLength: allDevices?.length || 0,
      heartRateLength: heartRateDevices?.length || 0,
      speedLength: speedDevices?.length || 0,
      cadenceLength: cadenceDevices?.length || 0,
      powerLength: powerDevices?.length || 0
    });
  }, [allDevices, deviceCount, connected, heartRateDevices, speedDevices, cadenceDevices, powerDevices]);

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

  const getDeviceUnit = (device) => {
    if (device.heartRate) return 'BPM';
    if (device.power) return 'W';
    if (device.cadence) return 'RPM';
    if (device.speedKmh) return 'km/h';
    return '';
  };

  const getDeviceColor = (device) => {
    if (device.heartRate !== undefined) return 'heart-rate';
    if (device.power !== undefined) return 'power';
    if (device.cadence !== undefined) return 'cadence';
    if (device.speedKmh !== undefined) return 'speed';
    return 'unknown';
  };

  return (
    <div className="fitness-devices-nav">
      {/* Connection Status Header */}
      <div className="nav-header">
        <Text size="sm" fw={600} c="white">Fitness Devices</Text>
        <div className={`connection-indicator ${connected ? 'connected' : 'disconnected'}`}></div>
      </div>
      
      {/* Fitness Devices as Nav Icons */}
      <div className="nav-devices">
        {allDevices.length > 0 ? (
          <Stack spacing="md">
            {allDevices.map((device) => (
              <div 
                key={`device-${device.deviceId}`} 
                className={`nav-device ${getDeviceColor(device)} ${device.isActive ? 'active' : 'inactive'}`}
                title={`Device ID: ${device.deviceId} - ${formatTimeAgo(device.lastSeen)}`}
              >
                <div className="device-icon">
                  {getDeviceIcon(device)}
                  <div className="device-number">{device.deviceId}</div>
                  {device.batteryLevel && (
                    <div className="battery-indicator">
                      <div 
                        className="battery-level" 
                        style={{ width: `${device.batteryLevel}%` }}
                      ></div>
                    </div>
                  )}
                </div>
                
                <div className="device-value">
                  {getDeviceValue(device)}
                </div>
                
                <div className="device-unit">
                  {getDeviceUnit(device)}
                </div>
              </div>
            ))}
          </Stack>
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
