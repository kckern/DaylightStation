/**
 * ArcadeShell — the "Video Games" welcome screen: a centered grid of game
 * covers with console tabs across the bottom.
 *
 * Host-agnostic and presentation-only: the library data and the launch/exit
 * handlers are injected. Owns grid focus + keyboard/gamepad navigation; the
 * actual launch flow (fingerprint, save/resume) lives in the host widget.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { GameGrid } from "./GameGrid.jsx";
import { ConsoleTabs } from "./ConsoleTabs.jsx";
import { useArcadeInput } from "./useArcadeInput.js";
import { nextGridIndex } from "./gridNav.js";
import { useGamepadStatus } from "../input/useGamepadStatus.js";
import { BluetoothScreen } from "../input/BluetoothScreen.jsx";
import { pairedRows } from "../input/bluetoothScreenModel.js";
import getLogger from '@/lib/logging/Logger.js';
import "./ArcadeShell.scss";

// Stable empty reference so that, when no controllers are configured, the value
// passed to useGamepadStatus keeps the same identity across renders. The `= []`
// default param creates a fresh array each render, which would otherwise churn
// useGamepadStatus's identity-keyed effect into an infinite re-render loop.
const EMPTY_CONTROLLERS = [];

export function ArcadeShell({
  consoles = [],
  games = [],
  systems = {},
  activeSystem: activeSystemProp,
  onSelectGame,
  onSelectConsole,
  onExit,
  resolveMediaUrl = (p) => p,
  inputEnabled = true,
  getGamepads,
  controllers = [],
  // The host's Bluetooth state + actions (see useFitnessBluetooth) and
  // input.yml's keyboard map, for the Bluetooth screen behind the chip.
  bluetooth = null,
  keyboardMap = null,
}) {
  const logger = useMemo(() => getLogger().child({ component: 'emu-arcade-shell' }), []);
  // Default the active console to the first real one when not driven externally.
  const firstRealSystem = useMemo(
    () => consoles.find((c) => !c.placeholder)?.system ?? null,
    [consoles],
  );
  const [internalSystem, setInternalSystem] = useState(firstRealSystem);
  const activeSystem = activeSystemProp ?? internalSystem;

  const visibleGames = useMemo(
    () => games.filter((g) => g.system === activeSystem),
    [games, activeSystem],
  );

  // Box-art shape belongs to the console, so it changes with the tab.
  const coverAspect = activeSystem ? systems?.[activeSystem]?.coverAspect : null;

  const [focusedIndex, setFocusedIndex] = useState(0);
  const [columns, setColumns] = useState(1);
  const [chipFocused, setChipFocused] = useState(false);
  const [ctrlPanelOpen, setCtrlPanelOpen] = useState(false);

  const selectConsole = useCallback((system) => {
    setFocusedIndex(0);
    if (onSelectConsole) onSelectConsole(system);
    else setInternalSystem(system);
  }, [onSelectConsole]);

  const handleIntent = useCallback((intent) => {
    if (chipFocused) {
      if (intent === 'select') { setCtrlPanelOpen(true); logger.info('arcade.bluetooth-open', { via: 'chip-focus' }); return; }
      if (intent === 'down' || intent === 'back') setChipFocused(false);
      return;
    }
    if (intent === 'select') {
      const game = visibleGames[focusedIndex];
      if (game) onSelectGame?.(game);
      return;
    }
    if (intent === 'back') { onExit?.(); return; }
    // Up from the top row reaches the Bluetooth chip, so a pad can open it.
    if (intent === 'up' && focusedIndex < columns) { setChipFocused(true); return; }
    setFocusedIndex((i) => nextGridIndex({ index: i, count: visibleGames.length, columns, dir: intent }));
  }, [chipFocused, visibleGames, focusedIndex, columns, onSelectGame, onExit, logger]);

  // The Bluetooth screen owns the keys and the pad while it is open.
  useArcadeInput({ onIntent: handleIntent, enabled: inputEnabled && !ctrlPanelOpen, getGamepads });

  // Controller connection status (browser pads + optional OS-level BT feed).
  // Forward a stable reference (module-level EMPTY when none) so the hook's
  // identity-keyed subscribe effect doesn't loop on the `= []` default param.
  const controllerList = (Array.isArray(controllers) && controllers.length > 0) ? controllers : EMPTY_CONTROLLERS;
  const { connected } = useGamepadStatus(controllerList, { getGamepads, btInventory: bluetooth?.inventory });
  // Bluetooth truth when the garage feed is there (the paired rows the screen
  // shows as Connected); browser pads only as a fallback.
  const btConnected = Array.isArray(bluetooth?.inventory)
    ? pairedRows(bluetooth.inventory, controllerList).filter((r) => r.status === 'connected').length
    : null;
  const connectedCount = btConnected ?? connected.length;
  const anyConnected = connectedCount > 0;
  const closePanel = useCallback(() => { setCtrlPanelOpen(false); logger.info('arcade.bluetooth-close', {}); }, [logger]);

  // Log connection-state transitions so we can see controller drops in prod.
  useEffect(() => {
    logger.debug('arcade.controller-connection-change', { connected: anyConnected, count: connectedCount });
  }, [anyConnected, connectedCount, logger]);

  return (
    <div className="emu-arcade-shell">
      <div className="emu-controller-indicator" data-connected={anyConnected ? '1' : '0'}>
        <button
          type="button"
          className={`emu-controller-chip${chipFocused ? ' is-focused' : ''}`}
          aria-expanded={ctrlPanelOpen}
          onClick={() => {
            setCtrlPanelOpen((v) => !v);
            logger.info('arcade.bluetooth-toggle', { open: !ctrlPanelOpen });
          }}
        >
          🎮 Bluetooth{anyConnected ? ` · ${connectedCount} connected` : ''}
        </button>
        {ctrlPanelOpen && (
          <div className="emu-controller-panel" role="dialog" aria-modal="true" aria-label="Bluetooth">
            <BluetoothScreen
              host="arcade"
              controllers={controllerList}
              keyboardMap={keyboardMap}
              bluetooth={bluetooth}
              getGamepads={getGamepads}
              onClose={closePanel}
            />
          </div>
        )}
      </div>
      <div className="emu-arcade-shell__body">
        <GameGrid
          games={visibleGames}
          focusedIndex={focusedIndex}
          onActivate={(game) => onSelectGame?.(game)}
          onColumnsChange={setColumns}
          resolveMediaUrl={resolveMediaUrl}
          coverAspect={coverAspect}
        />
      </div>
      <ConsoleTabs consoles={consoles} activeSystem={activeSystem} onSelect={selectConsole} />
    </div>
  );
}

export default ArcadeShell;
