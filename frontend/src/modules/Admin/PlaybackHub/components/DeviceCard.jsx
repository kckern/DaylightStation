import React from 'react';
import { Paper, Accordion, Stack } from '@mantine/core';
import { DeviceHeader } from './DeviceHeader.jsx';
import { TransportRow } from './TransportRow.jsx';
import { SchedulesSection } from './SchedulesSection.jsx';
import { ScheduledFiresSection } from './ScheduledFiresSection.jsx';
import { VolumeLimitsSection } from './VolumeLimitsSection.jsx';
import { HomeAutomationSection } from './HomeAutomationSection.jsx';
import './DeviceCard.scss';

/**
 * DeviceCard — top-level composition for a single device slot.
 *
 * Always-visible:  DeviceHeader (live status + color avatar + volume gauge)
 *                  TransportRow (prev/play-pause/next, volume slider, content picker)
 *
 * Collapsible (Mantine Accordion, multi-expand):
 *   private devices: continuous schedules, scheduled fires, volume limits
 *   public devices:  scheduled fires, volume limits, home automation
 *
 * Note on naming: the section is labeled "Home Automation" (the bounded
 * context) rather than the vendor name. Vendor-specific code lives in
 * 1_adapters/ only.
 *
 * Props:
 *   slot:            device config from useHubConfig
 *                    { color, class, volume:{default,min,max}, continuous?, ... }
 *   status:          live status for this slot from useHubStatus
 *                    { bt_connected, paused, now_playing, volume, ... } | undefined
 *   scheduledFires:  array of scheduled fires already filtered to slot.color
 *                    (the parent page passes only this slot's fires here)
 *   mutations:       object from useHubMutations
 */
export function DeviceCard({ slot, status, scheduledFires, mutations }) {
  const isPrivate = slot?.class === 'private';
  const isPublic = slot?.class === 'public';

  return (
    <Paper withBorder p="md" className="playback-hub-device-card">
      <Stack gap="sm">
        <DeviceHeader slot={slot} status={status} />
        <TransportRow slot={slot} status={status} mutations={mutations} />
        <Accordion variant="separated" multiple>
          {isPrivate && (
            <Accordion.Item value="schedules">
              <Accordion.Control>Continuous schedules</Accordion.Control>
              <Accordion.Panel>
                <SchedulesSection slot={slot} mutations={mutations} />
              </Accordion.Panel>
            </Accordion.Item>
          )}
          <Accordion.Item value="scheduled-fires">
            <Accordion.Control>Scheduled fires</Accordion.Control>
            <Accordion.Panel>
              <ScheduledFiresSection
                target={slot.color}
                fires={scheduledFires ?? []}
                slotMaxVolume={slot?.volume?.max ?? 100}
                mutations={mutations}
              />
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="volume-limits">
            <Accordion.Control>Volume limits</Accordion.Control>
            <Accordion.Panel>
              <VolumeLimitsSection slot={slot} mutations={mutations} />
            </Accordion.Panel>
          </Accordion.Item>
          {isPublic && (
            <Accordion.Item value="home-automation">
              <Accordion.Control>Home Automation</Accordion.Control>
              <Accordion.Panel>
                <HomeAutomationSection slot={slot} mutations={mutations} />
              </Accordion.Panel>
            </Accordion.Item>
          )}
        </Accordion>
      </Stack>
    </Paper>
  );
}

export default DeviceCard;
