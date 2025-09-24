import React, { useState, useEffect } from 'react';
import { Paper, Group, Text, Badge, Stack, Card } from '@mantine/core';
import { useFitnessWebSocket } from '../../hooks/useFitnessWebSocket.js';

const FitnessUsers = () => {
  // Use the fitness-specific WebSocket hook
  const { connected, heartRateDevices, deviceCount, latestData, lastUpdate } = useFitnessWebSocket();

  // Debug logging
  useEffect(() => {
    console.log(`🎯 FitnessUsers: ${deviceCount} devices, connected: ${connected}`);
    console.log('🎯 heartRateDevices:', heartRateDevices);
  }, [heartRateDevices, deviceCount, connected]);

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

  return (
    <div>
      {/* Connection Status Header */}
      <Group position="apart" mb="md">
        <Text size="lg" fw={600} c="white">Heart Rate Monitor</Text>
        <Group>
          {deviceCount > 0 && (
            <Badge color="blue" variant="filled">
              {deviceCount} Device{deviceCount !== 1 ? 's' : ''}
            </Badge>
          )}
          <Badge 
            color={connected ? 'green' : 'red'} 
            variant="filled"
          >
            {connected ? 'Connected' : 'Disconnected'}
          </Badge>
        </Group>
      </Group>
      
      {/* Heart Rate Devices Display */}
      {heartRateDevices.length > 0 ? (
        <Stack spacing="md">
          <Text size="sm" c="yellow">DEBUG: Rendering {heartRateDevices.length} devices</Text>
          {heartRateDevices.map((device, index) => {
            console.log(`🔄 Rendering device ${index}:`, device);
            return (
              <Card 
                key={`${device.deviceId}-${index}`} 
                mb="sm" 
                p="sm" 
                bg={device.isActive ? "dark.7" : "dark.8"}
                style={{ 
                  border: `2px solid ${index === 0 ? 'red' : 'blue'}`,
                  maxHeight: '120px',
                  overflow: 'hidden'
                }}
              >
                <Stack spacing="xs">
                  <Group position="apart">
                    <Text size="sm" fw={600} c="red">❤️ Heart Rate #{index + 1}</Text>
                    <Text size="xs" c="dimmed">
                      Device: {device.deviceId}
                    </Text>
                  </Group>
                  <Group align="center" spacing="xs">
                    <Text size={28} fw={700} c={device.isActive ? "red" : "gray"} style={{ lineHeight: 1 }}>
                      {console.log(`💗 Displaying BPM for device ${device.deviceId}:`, device.value, typeof device.value)}
                      {device.value !== undefined && device.value !== null ? device.value : 'NO VALUE'}
                    </Text>
                    <Text size="sm" c="dimmed">BPM</Text>
                  </Group>
                  <Group position="apart">
                    <Text size="xs" c="dimmed">
                      {formatTimeAgo(device.lastSeen)}
                    </Text>
                    {device.batteryLevel && (
                      <Text size="xs" c="dimmed">
                        🔋 {device.batteryLevel}%
                      </Text>
                    )}
                  </Group>
                </Stack>
              </Card>
            );
          })}
        </Stack>
      ) : (
        <Card p="lg" bg="dark.8">
          <Stack align="center" spacing="md">
            <Text size="lg" c="dimmed">No heart rate devices detected</Text>
            <Text size="sm" c="dimmed" ta="center">
              Make sure your ANT+ heart rate monitor is turned on and within range
            </Text>
          </Stack>
        </Card>
      )}

      {/* Latest Data Debug */}
      {latestData && (
        <Card p="sm" bg="dark.8" mt="md">
          <Text size="xs" c="dimmed" mb="xs">Latest Data:</Text>
          <Text size="xs" c="dimmed" ff="monospace">
            {JSON.stringify(latestData, null, 2)}
          </Text>
        </Card>
      )}
    </div>
  );
};

export default FitnessUsers;
