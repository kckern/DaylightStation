import React, { useMemo } from 'react';
import {
  UserAvatarGrid,
  DeviceAvatar,
  HeartRateDisplay,
  ZoneIndicator,
  TreasureBoxWidget,
  MusicPlayerWidget,
  WebcamView
} from '../../../../shared';
import useFitnessPlugin from '../../../useFitnessPlugin';
import ComponentCard from '../components/ComponentCard';

const IntegrationsSection = () => {
  const {
    participants = [],
    heartRateDevices = [],
    cadenceDevices = [],
    userVitalsMap,
    userCurrentZones = [],
    treasureBox,
    musicEnabled,
    selectedPlaylistId
  } = useFitnessPlugin('component_showcase');

  const hrDevice = heartRateDevices?.[0];
  const cadenceDevice = cadenceDevices?.[0];

  const liveHeartRate = useMemo(() => {
    if (hrDevice?.value) return hrDevice.value;
    if (!userVitalsMap || typeof userVitalsMap.values !== 'function') return null;
    for (const val of userVitalsMap.values()) {
      const bpm = Number(val?.heartRate ?? val?.hr ?? val?.bpm);
      if (Number.isFinite(bpm)) return bpm;
    }
    return null;
  }, [hrDevice, userVitalsMap]);

  const currentZone = useMemo(() => {
    const primary = Array.isArray(userCurrentZones) ? userCurrentZones[0] : null;
    return Number(primary?.zone || primary?.zoneId || primary) || 0;
  }, [userCurrentZones]);

  const demoTrack = {
    title: selectedPlaylistId ? `Playlist ${selectedPlaylistId}` : 'Demo Track',
    artist: musicEnabled ? 'Live Session' : 'Offline',
    coverUrl: null
  };

  return (
    <div className="cs-demo-grid">
      <ComponentCard
        title="UserAvatarGrid"
        description="Roster-driven grid with fallback demo users."
        badge={participants.length ? 'Live data' : 'Demo'}
      >
        <UserAvatarGrid
          users={participants.length ? participants : [
            { id: 'demo1', name: 'Avery' },
            { id: 'demo2', name: 'Jordan' },
            { id: 'demo3', name: 'Riley' }
          ]}
          layout="grid"
          maxVisible={12}
        />
      </ComponentCard>

      <ComponentCard
        title="DeviceAvatar"
        description="Heart rate and cadence devices with live RPM."
      >
        {hrDevice ? (
          <DeviceAvatar
            rpm={hrDevice.rpm || hrDevice.value || 0}
            avatarSrc={hrDevice.avatarUrl}
            avatarAlt={hrDevice.id}
            size="md"
            showValue
            valueFormat={(v) => `${v || '--'} bpm`}
          />
        ) : <div className="cs-empty">No HR device</div>}

        {cadenceDevice ? (
          <DeviceAvatar
            rpm={cadenceDevice.rpm || cadenceDevice.value || 0}
            avatarSrc={cadenceDevice.avatarUrl}
            avatarAlt={cadenceDevice.id}
            size="md"
            showValue
            valueFormat={(v) => `${v || '--'} rpm`}
          />
        ) : <div className="cs-empty">No cadence device</div>}
      </ComponentCard>

      <ComponentCard
        title="HeartRateDisplay & ZoneIndicator"
        description="Live BPM with zone tint when available."
        badge={Number.isFinite(liveHeartRate) ? 'Live data' : 'Demo'}
      >
        <HeartRateDisplay
          bpm={Number.isFinite(liveHeartRate) ? liveHeartRate : 128}
          zone={currentZone || 3}
          size="md"
        />
        <ZoneIndicator zone={currentZone || 3} label={currentZone ? `Zone ${currentZone}` : 'Demo Zone'} />
      </ComponentCard>

      <ComponentCard
        title="TreasureBoxWidget"
        description="Coins and rewards preview from session treasure box."
        badge={treasureBox ? 'Live data' : 'Demo'}
      >
        <TreasureBoxWidget
          isOpen={false}
          onOpen={() => {}}
          rewards={(treasureBox?.rewards || [{ icon: '💰', label: 'Coins' }]).slice(0, 3)}
          description={`Coins: ${treasureBox?.coins ?? treasureBox?.totalCoins ?? '—'}`}
        />
      </ComponentCard>

      <ComponentCard
        title="MusicPlayerWidget"
        description="Mini player with playlist-aware title."
      >
        <MusicPlayerWidget
          track={demoTrack}
          isPlaying={!!musicEnabled}
          progress={22}
          duration={180}
          onPlayPause={() => {}}
          onNext={() => {}}
          onPrevious={() => {}}
        />
      </ComponentCard>

      <ComponentCard
        title="WebcamView"
        description="Camera preview with overlay slot (disabled by default)."
      >
        <WebcamView enabled={false} aspectRatio="16:9" overlay={<div className="cs-empty">Camera disabled</div>} />
      </ComponentCard>
    </div>
  );
};

export default IntegrationsSection;
