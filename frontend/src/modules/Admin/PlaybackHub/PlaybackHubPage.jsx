import React from 'react';
import { Stack, Loader, Alert, Text } from '@mantine/core';
import { useHubStatus } from './hooks/useHubStatus';
import { useHubConfig } from './hooks/useHubConfig';
import { useHubMutations } from './hooks/useHubMutations';
import { useStaleness } from './hooks/useStaleness';
import { useStatusOverlay } from '../../../hooks/useStatusOverlay';
import DeviceCard from './components/DeviceCard';
import { StalenessBanner } from './components/StalenessBanner.jsx';
import './PlaybackHubPage.scss';

/**
 * PlaybackHubPage — single-page admin entry for the playback-hub bounded
 * context. Renders one DeviceCard per device in the config.
 *
 * Composes:
 *   useHubStatus()    → { devices, fetchedAt }
 *   useStatusOverlay()→ { statusView, predict, pending } (optimistic overlay)
 *   useHubConfig()    → { config, loading, error, revalidate }
 *   useHubMutations() → { sendCommand, updateDevice, saveFire, deleteFire }
 *
 * The `statusView` from useStatusOverlay wraps the raw WS status with
 * optimistic predictions so a click flips the UI immediately while the
 * affected control greys out until the WS broadcaster confirms.
 */
export default function PlaybackHubPage() {
  const { devices: realStatus, fetchedAt: statusFetchedAt } = useHubStatus();
  const { statusView, predict, pending } = useStatusOverlay(realStatus);
  const { config, loading, error, revalidate } = useHubConfig();
  const mutations = useHubMutations({ revalidate });
  const { isStale, secondsSinceUpdate } = useStaleness(statusFetchedAt);

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
      <StalenessBanner isStale={isStale} secondsSinceUpdate={secondsSinceUpdate} />
      {config.devices.map((device) => (
        <DeviceCard
          key={device.color}
          slot={device}
          status={statusView.get(device.color)}
          scheduledFires={allFires.filter((f) => f.target === device.color)}
          mutations={mutations}
          predict={predict}
          pending={pending}
        />
      ))}
    </Stack>
  );
}
