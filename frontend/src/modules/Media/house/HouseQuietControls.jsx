// frontend/src/modules/Media/house/HouseQuietControls.jsx
// Pause all / Stop all / Resume all (RQ-STEER-13) — on the house view
// (`HouseQuietBar`) and on the handle (`HandleHouseMenu`). Results, including
// every screen not reached, arrive through the outcome tray.
import React from 'react';
import { ActionIcon, Button, Menu } from '@mantine/core';
import { IconHome, IconPlayerPauseFilled, IconPlayerPlayFilled, IconPlayerStopFilled } from '@tabler/icons-react';
import { useHouseQuiet } from './houseQuiet.js';
import './House.scss';

export function HouseQuietBar() {
  const { pauseAll, stopAll, resumeAll, busy, canResume, resumable, playingCount, activeCount } = useHouseQuiet();
  // Nothing to pause, stop or resume: no bar (a row of disabled buttons says nothing).
  if (playingCount === 0 && activeCount === 0 && !canResume) return null;
  return (
    <div className="house-toolbar" data-testid="house-quiet-bar" role="group" aria-label="Whole house">
      {playingCount > 0 && (
      <Button
        data-testid="house-pause-all"
        variant="default"
        className="house-action"
        leftSection={<IconPlayerPauseFilled size={16} aria-hidden />}
        disabled={playingCount === 0 || !!busy}
        loading={busy === 'pause'}
        onClick={pauseAll}
      >
        Pause all
      </Button>
      )}
      {activeCount > 0 && (
      <Button
        data-testid="house-stop-all"
        variant="default"
        className="house-action"
        leftSection={<IconPlayerStopFilled size={16} aria-hidden />}
        disabled={activeCount === 0 || !!busy}
        loading={busy === 'stop'}
        onClick={stopAll}
      >
        Stop all
      </Button>
      )}
      {canResume && (
        <Button
          data-testid="house-resume-all"
          variant="light"
          className="house-action"
          leftSection={<IconPlayerPlayFilled size={16} aria-hidden />}
          disabled={!!busy}
          loading={busy === 'resume'}
          onClick={resumeAll}
        >
          Resume all ({resumable.length})
        </Button>
      )}
    </div>
  );
}

/** The handle's house-wide menu: one 44px button, three items. */
export function HandleHouseMenu() {
  const { pauseAll, stopAll, resumeAll, busy, canResume, resumable, playingCount, activeCount } = useHouseQuiet();
  return (
    <Menu position="top-end" withinPortal>
      <Menu.Target>
        <ActionIcon
          size={44}
          variant="subtle"
          aria-label="Whole house: pause, stop or resume every screen"
          data-testid="mini-house-menu"
          loading={!!busy}
        >
          <IconHome size={18} aria-hidden />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown data-testid="mini-house-menu-panel">
        <Menu.Label>Whole house</Menu.Label>
        <Menu.Item data-testid="mini-pause-all" leftSection={<IconPlayerPauseFilled size={16} aria-hidden />} disabled={playingCount === 0} onClick={pauseAll}>
          Pause all
        </Menu.Item>
        <Menu.Item data-testid="mini-stop-all" leftSection={<IconPlayerStopFilled size={16} aria-hidden />} disabled={activeCount === 0} onClick={stopAll}>
          Stop all
        </Menu.Item>
        {canResume && (
          <Menu.Item data-testid="mini-resume-all" leftSection={<IconPlayerPlayFilled size={16} aria-hidden />} onClick={resumeAll}>
            Resume all ({resumable.length})
          </Menu.Item>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}
