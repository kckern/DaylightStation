import React, { useMemo } from 'react';
import useFitnessPlugin from '../../../useFitnessPlugin';
import UserAvatarGrid from '../../../../shared/integrations/UserAvatarGrid/UserAvatarGrid.jsx';
import ZoneIndicator from '../../../../shared/integrations/ZoneIndicator/ZoneIndicator.jsx';
import DeviceAvatar from '../../../../shared/integrations/DeviceAvatar/DeviceAvatar.jsx';
import HeartRateDisplay from '../../../../shared/integrations/HeartRateDisplay/HeartRateDisplay.jsx';

const LiveContextSection = () => {
  const {
    participants = [],
    zones = [],
    userVitalsMap,
    heartRateDevices = [],
    cadenceDevices = [],
    powerDevices = [],
    allDevices = [],
    governanceState,
    governanceChallenge,
    activeGovernancePolicy,
    treasureBox,
    userCurrentZones = [],
    sessionActive,
    isSessionActive,
    connected
  } = useFitnessPlugin('component_showcase');

  const avgHeartRate = useMemo(() => {
    if (!userVitalsMap || typeof userVitalsMap.forEach !== 'function') return null;
    let total = 0;
    let count = 0;
    userVitalsMap.forEach((v) => {
      const bpm = Number(v?.heartRate ?? v?.hr ?? v?.bpm);
      if (Number.isFinite(bpm)) {
        total += bpm;
        count += 1;
      }
    });
    if (count === 0) return null;
    return Math.round(total / count);
  }, [userVitalsMap]);

  const currentZone = useMemo(() => {
    const primary = Array.isArray(userCurrentZones) ? userCurrentZones[0] : null;
    const zoneId = primary?.zone || primary?.zoneId || primary || null;
    return Number(zoneId) || 0;
  }, [userCurrentZones]);

  const hasSession = sessionActive || isSessionActive;
  const devicesConnected = allDevices?.length || 0;
  const hrDevice = heartRateDevices?.[0];
  const cadenceDevice = cadenceDevices?.[0];

  return (
    <div className="cs-live-grid">
      <div className="cs-card">
        <div className="cs-card-header">
          <div>
            <p className="cs-card-kicker">Participants</p>
            <h3 className="cs-card-title">Roster</h3>
          </div>
          <span className={`cs-chip ${hasSession ? 'chip-live' : 'chip-demo'}`}>
            {hasSession ? 'Live' : 'Demo'}
          </span>
        </div>
        {participants?.length ? (
          <UserAvatarGrid users={participants} layout="grid" maxVisible={12} size="md" />
        ) : (
          <div className="cs-empty">No active participants</div>
        )}
      </div>

      <div className="cs-card">
        <div className="cs-card-header">
          <div>
            <p className="cs-card-kicker">Zones</p>
            <h3 className="cs-card-title">Heart Rate Reference</h3>
          </div>
          <span className="cs-chip">{zones?.length || 0} zones</span>
        </div>
        <div className="cs-zone-strip">
          {Array.isArray(zones) && zones.length > 0 ? (
            zones.map((zone) => (
              <div key={zone.id || zone.name} className="cs-zone-item">
                <ZoneIndicator zone={zone.id || zone.zone || 0} label={zone.name || `Zone ${zone.id}`} />
                <div className="cs-zone-meta">
                  <span>{zone.name || 'Zone'}</span>
                  {zone.min != null && zone.max != null && (
                    <span className="cs-zone-range">{zone.min}%–{zone.max}%</span>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="cs-empty">Zone configuration unavailable</div>
          )}
        </div>
        {currentZone > 0 && (
          <div className="cs-zone-current">Current zone: Z{currentZone}</div>
        )}
      </div>

      <div className="cs-card">
        <div className="cs-card-header">
          <div>
            <p className="cs-card-kicker">Devices</p>
            <h3 className="cs-card-title">Connectivity</h3>
          </div>
          <span className={`cs-chip ${connected ? 'chip-live' : 'chip-demo'}`}>
            {connected ? 'Connected' : 'Offline'}
          </span>
        </div>
        <div className="cs-device-grid">
          <div className="cs-device-stat">
            <p className="cs-device-label">All devices</p>
            <p className="cs-device-value">{devicesConnected}</p>
          </div>
          <div className="cs-device-stat">
            <p className="cs-device-label">Heart rate</p>
            <p className="cs-device-value">{heartRateDevices?.length || 0}</p>
          </div>
          <div className="cs-device-stat">
            <p className="cs-device-label">Cadence</p>
            <p className="cs-device-value">{cadenceDevices?.length || 0}</p>
          </div>
          <div className="cs-device-stat">
            <p className="cs-device-label">Power</p>
            <p className="cs-device-value">{powerDevices?.length || 0}</p>
          </div>
        </div>
        <div className="cs-device-avatars">
          {hrDevice ? (
            <DeviceAvatar
              rpm={hrDevice.rpm || hrDevice.value || 0}
              avatarSrc={hrDevice.avatarUrl}
              avatarAlt={hrDevice.id || 'HR device'}
              size="md"
              showValue
              valueFormat={(v) => `${v || '--'} bpm`}
            />
          ) : (
            <div className="cs-empty">No heart rate devices</div>
          )}
          {cadenceDevice ? (
            <DeviceAvatar
              rpm={cadenceDevice.rpm || cadenceDevice.value || 0}
              avatarSrc={cadenceDevice.avatarUrl}
              avatarAlt={cadenceDevice.id || 'Cadence device'}
              size="md"
              showValue
              valueFormat={(v) => `${v || '--'} rpm`}
            />
          ) : (
            <div className="cs-empty">No cadence devices</div>
          )}
        </div>
      </div>

      <div className="cs-card">
        <div className="cs-card-header">
          <div>
            <p className="cs-card-kicker">Vitals</p>
            <h3 className="cs-card-title">Session Summary</h3>
          </div>
          <span className="cs-chip">{participants?.length || 0} participants</span>
        </div>
        <div className="cs-vitals">
          <div className="cs-vitals-main">
            <HeartRateDisplay
              bpm={avgHeartRate || 0}
              zone={currentZone || 0}
              size="md"
              className="cs-hr"
            />
          </div>
          <div className="cs-vitals-meta">
            <div>
              <p className="cs-device-label">Treasure coins</p>
              <p className="cs-device-value">{treasureBox?.coins ?? '—'}</p>
            </div>
            <div>
              <p className="cs-device-label">Challenge</p>
              <p className="cs-device-value">{governanceChallenge?.status || 'idle'}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="cs-card">
        <div className="cs-card-header">
          <div>
            <p className="cs-card-kicker">Governance</p>
            <h3 className="cs-card-title">State</h3>
          </div>
          <span className="cs-chip">{governanceState?.status || 'idle'}</span>
        </div>
        <div className="cs-governance">
          <div>
            <p className="cs-device-label">Active policy</p>
            <p className="cs-device-value">{activeGovernancePolicy?.name || 'None'}</p>
          </div>
          <div>
            <p className="cs-device-label">Phase</p>
            <p className="cs-device-value">{governanceChallenge?.phase || '—'}</p>
          </div>
          <div>
            <p className="cs-device-label">Mode</p>
            <p className="cs-device-value">{governanceChallenge?.mode || governanceState?.mode || '—'}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiveContextSection;
