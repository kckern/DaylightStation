// frontend/src/modules/Media/shell/MoveToMenu.jsx
// "Move to…" on another screen's controls (PLACE.9a, RQ-PLACE-13): lists
// every other screen, including this device; the destination picks up at
// the same moment and the original stops (cast/screenMove.js). The result is
// one outcome, named with the destination; a move to this device opens Now
// Playing.
import React, { useContext, useState } from 'react';
import { Button, Menu } from '@mantine/core';
import { IconArrowForwardUp } from '@tabler/icons-react';
import { useFleetContext } from '../fleet/useFleetContext.js';
import { deviceName, deviceLocation } from '../fleet/deviceDisplay.js';
import { LocalSessionContext } from '../session/LocalSessionContext.js';
import { ClientIdentityContext } from '../identity/ClientIdentityProvider.jsx';
import { DispatchContext } from '../cast/DispatchProvider.jsx';
import { moveScreenPlayback, moveFailureReason } from '../cast/screenMove.js';
import { useNav } from './NavProvider.jsx';
import './SessionControls.scss';

/** Screens playback can move to: content screens other than the source. */
export function moveDestinations(devices = [], sourceId) {
  return devices.filter((device) => typeof device?.id === 'string'
    && device.id !== sourceId
    && !device.id.startsWith('browser:')
    && (device.content_control || device.fleet === true));
}

export function MoveToMenu({ sourceId, available = true, title = null }) {
  const { devices = [], store, identity: fleetIdentity } = useFleetContext();
  const localController = useContext(LocalSessionContext)?.controller ?? null;
  const identity = useContext(ClientIdentityContext);
  const outcomes = useContext(DispatchContext);
  const { push } = useNav();
  const [moving, setMoving] = useState(false);
  const choices = moveDestinations(devices, sourceId);

  const move = async (destinationId) => {
    if (moving) return;
    setMoving(true);
    const destinationName = destinationId === 'local' ? null : deviceName(devices.find((d) => d.id === destinationId), destinationId);
    // PLACE.7a/AC3: the confirmation says which screen it came from.
    const sourceName = deviceName(devices.find((d) => d.id === sourceId) ?? { id: sourceId }, sourceId);
    const originId = fleetIdentity?.deviceId ?? (identity?.clientId ? `browser:${identity.clientId}` : null);
    const attemptId = outcomes?.recordLocal?.({
      kind: 'move', phase: 'running', item: { title: title ?? 'what was playing' },
      targetId: destinationId, targetName: destinationName, command: { sourceId, sourceName },
    }) ?? null;
    const result = await moveScreenPlayback({
      sourceId, destinationId, fleetStore: store, localController,
      origin: originId ? { kind: 'device', id: originId, ...(identity?.displayName ? { name: String(identity.displayName).slice(0, 80) } : {}) } : null,
    });
    setMoving(false);
    if (result.ok) {
      outcomes?.resolveLocal?.(attemptId, { phase: 'confirmed' });
      if (destinationId === 'local') push('nowPlaying', {});
    } else {
      outcomes?.resolveLocal?.(attemptId, { phase: 'failed', reason: moveFailureReason(result) });
    }
  };

  return (
    <Menu position="bottom-start" withinPortal shadow="md" disabled={!available || moving}>
      <Menu.Target>
        <Button
          data-testid="peek-move-to"
          className="session-controls-btn"
          variant="default"
          leftSection={<IconArrowForwardUp size={16} />}
          disabled={!available || moving}
          loading={moving}
        >
          Move to…
        </Button>
      </Menu.Target>
      <Menu.Dropdown data-testid="move-to-menu">
        <Menu.Label>Move this playback to</Menu.Label>
        <Menu.Item data-testid="move-to-local" className="session-controls-menu-item" onClick={() => move('local')}>
          This device
        </Menu.Item>
        {choices.map((device) => (
          <Menu.Item
            key={device.id}
            data-testid={`move-to-${device.id}`}
            className="session-controls-menu-item"
            onClick={() => move(device.id)}
          >
            {deviceName(device, device.id)}{deviceLocation(device) ? ` · ${deviceLocation(device)}` : ''}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}

export default MoveToMenu;
