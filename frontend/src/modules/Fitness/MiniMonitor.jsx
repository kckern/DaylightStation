import React from 'react';
import './MiniMonitor.scss';

const MiniMonitor = ({ devices = [], type = 'heart-rate' }) => {
  // Get the most recent active device of the specified type
  const getActiveDevice = () => {
    if (!devices || devices.length === 0) return null;
    
    // Find the most recently updated active device
    const activeDevices = devices.filter(device => device.isActive);
    if (activeDevices.length === 0) return devices[0]; // Fallback to first device
    
    return activeDevices.reduce((latest, current) => {
      if (!latest.lastSeen) return current;
      if (!current.lastSeen) return latest;
      return current.lastSeen > latest.lastSeen ? current : latest;
    });
  };

  const activeDevice = getActiveDevice();
  
  // Determine what value to display based on type and available data
  const getDisplayValue = () => {
    if (!activeDevice) return null;
    
    // Priority order for different metrics
    if (activeDevice.heartRate) {
      return { value: activeDevice.heartRate, unit: 'BPM', type: 'heart-rate' };
    }
    
    if (activeDevice.power) {
      return { value: activeDevice.power, unit: 'W', type: 'power' };
    }
    
    if (activeDevice.cadence) {
      return { value: activeDevice.cadence, unit: 'RPM', type: 'cadence' };
    }
    
    if (activeDevice.speedKmh) {
      return { value: activeDevice.speedKmh.toFixed(1), unit: 'km/h', type: 'speed' };
    }
    
    return null;
  };

  const displayData = getDisplayValue();
  
  // Don't render if no data
  if (!displayData) {
    return null;
  }

  // Get appropriate CSS class for animation/styling
  const getTypeClass = () => {
    switch (displayData.type) {
      case 'heart-rate': return 'heart-rate';
      case 'power': return 'power';
      case 'cadence': return 'cadence';
      case 'speed': return 'speed';
      default: return 'default';
    }
  };

  return (
    <div className={`mini-monitor ${getTypeClass()}`}>
      <div className="monitor-value">
        {displayData.value}
      </div>
      <div className="monitor-unit">
        {displayData.unit}
      </div>
    </div>
  );
};

export default MiniMonitor;