// frontend/src/modules/Media/shell/Dock.jsx
// The app's constant: search (always one keystroke away), fleet indicator,
// cast target chip, mini player, settings. Mobile shows search + compact
// cluster; the fleet indicator and mini player live in the bottom chrome
// there instead.
import React from 'react';
import { TextInput, ActionIcon } from '@mantine/core';
import { IconSearch, IconSettings } from '@tabler/icons-react';
import { FleetIndicator } from './FleetIndicator.jsx';

export function Dock() {
  return (
    <header className="media-dock" data-testid="media-dock">
      {/* Placeholder until the search module lands (Phase 3) */}
      <TextInput
        className="media-dock-search"
        size="md"
        radius="md"
        placeholder="Search…"
        leftSection={<IconSearch size={18} />}
        readOnly
        data-testid="media-search-input"
        aria-label="Search"
      />
      <div className="media-dock-cluster">
        <FleetIndicator />
        <ActionIcon aria-label="Settings" data-testid="settings-menu-trigger">
          <IconSettings size={20} />
        </ActionIcon>
      </div>
    </header>
  );
}

export default Dock;
