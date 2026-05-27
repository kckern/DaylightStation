import React from 'react';
import { Stack, Loader, Alert, Text } from '@mantine/core';
import { useHubStatus } from './hooks/useHubStatus';
import { useHubConfig } from './hooks/useHubConfig';
import { useHubMutations } from './hooks/useHubMutations';
import DeviceCard from './components/DeviceCard';
import './PlaybackHubPage.scss';

/**
 * PlaybackHubPage — single-page admin entry for the playback-hub bounded
 * context. Renders one DeviceCard per device in the config.
 *
 * Composes:
 *   useHubStatus()   → Map<color, SlotStatus> live snapshot
 *   useHubConfig()   → { config, loading, error, revalidate }
 *   useHubMutations()→ { sendCommand, updateDevice, saveFire, deleteFire }
 *
 * The config aggregate uses keys `devices` and `scheduled` per
 * HubConfig.toYaml(); scheduled fires are filtered by target color before
 * being handed down to each DeviceCard.
 */
export default function PlaybackHubPage() {
  const { devices: statusByColor, fetchedAt: statusFetchedAt } = useHubStatus();
  const { config, loading, error, revalidate } = useHubConfig();
  const mutations = useHubMutations({ revalidate });

  if (loading && !config) {
    return <Loader p="md" />;
  }
  if (error && !config) {
    return (
      <Alert color="red" title="Couldn't load Playback Hub config" m="md">
        {error}
      </Alert>
    );
  }
  if (!config?.devices?.length) {
    return (
      <Text c="dimmed" p="md">
        No devices configured.
      </Text>
    );
  }

  const allFires = config.scheduled || [];

  return (
    <Stack gap="md" p="md" className="playback-hub-page">
      {config.devices.map((device) => (
        <DeviceCard
          key={device.color}
          slot={device}
          status={statusByColor.get(device.color)}
          scheduledFires={allFires.filter((f) => f.target === device.color)}
          mutations={mutations}
        />
      ))}
    </Stack>
  );
}
