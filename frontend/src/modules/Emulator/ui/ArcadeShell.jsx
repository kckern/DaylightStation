/**
 * ArcadeShell — the "Video Games" welcome screen: a centered grid of game
 * covers with console tabs across the bottom.
 *
 * Host-agnostic and presentation-only: the library data and the launch/exit
 * handlers are injected. Owns grid focus + keyboard/gamepad navigation; the
 * actual launch flow (fingerprint, save/resume) lives in the host widget.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { GameGrid } from './GameGrid.jsx';
import { ConsoleTabs } from './ConsoleTabs.jsx';
import { useArcadeInput } from './useArcadeInput.js';
import { nextGridIndex } from './gridNav.js';
import { useGamepadStatus } from '../input/useGamepadStatus.js';
import { ControllerStatus } from '../input/ControllerStatus.jsx';
import getLogger from '@/lib/logging/Logger.js';
import './ArcadeShell.scss';

// Stable empty reference so that, when no controllers are configured, the value
// passed to useGamepadStatus keeps the same identity across renders. The `= []`
// default param creates a fresh array each render, which would otherwise churn
// useGamepadStatus's identity-keyed effect into an infinite re-render loop.
const EMPTY_CONTROLLERS = [];

export function ArcadeShell({
  consoles = [],
  games = [],
  activeSystem: activeSystemProp,
  onSelectGame,
  onSelectConsole,
  onExit,
  resolveMediaUrl = (p) => p,
  inputEnabled = true,
  getGamepads,
  controllers = [],
  btInventory,
  controllerPairing,
  onPairController,
  onForgetController,
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

  const [focusedIndex, setFocusedIndex] = useState(0);
  const [columns, setColumns] = useState(1);

  const selectConsole = useCallback((system) => {
    setFocusedIndex(0);
    if (onSelectConsole) onSelectConsole(system);
    else setInternalSystem(system);
  }, [onSelectConsole]);

  const handleIntent = useCallback((intent) => {
    if (intent === 'select') {
      const game = visibleGames[focusedIndex];
      if (game) onSelectGame?.(game);
      return;
    }
    if (intent === 'back') { onExit?.(); return; }
    setFocusedIndex((i) => nextGridIndex({ index: i, count: visibleGames.length, columns, dir: intent }));
  }, [visibleGames, focusedIndex, columns, onSelectGame, onExit]);

  useArcadeInput({ onIntent: handleIntent, enabled: inputEnabled, getGamepads });

  // Controller connection status (browser pads + optional OS-level BT feed).
  // Forward a stable reference (module-level EMPTY when none) so the hook's
  // identity-keyed subscribe effect doesn't loop on the `= []` default param.
  const controllerList = (Array.isArray(controllers) && controllers.length > 0) ? controllers : EMPTY_CONTROLLERS;
  const { connected } = useGamepadStatus(controllerList, { getGamepads, btInventory });
  const anyConnected = connected.length > 0;
  const [ctrlPanelOpen, setCtrlPanelOpen] = useState(false);

  // Log connection-state transitions so we can see controller drops in prod.
  useEffect(() => {
    logger.debug('arcade.controller-connection-change', { connected: anyConnected, count: connected.length });
  }, [anyConnected, connected.length, logger]);

  return (
    <div className="emu-arcade-shell">
      <div className="emu-controller-indicator" data-connected={anyConnected ? '1' : '0'}>
        <button
          type="button"
          className="emu-controller-chip"
          aria-expanded={ctrlPanelOpen}
          onClick={() => {
            setCtrlPanelOpen((v) => !v);
            logger.debug('arcade.controller-panel-toggle', { open: !ctrlPanelOpen });
          }}
        >
          🎮 {anyConnected ? 'Controller connected' : 'No controller'}
        </button>
        {ctrlPanelOpen && (
          <div className="emu-controller-panel" role="dialog" aria-label="Controllers">
            <ControllerStatus
              controllers={controllerList}
              btInventory={btInventory}
              getGamepads={getGamepads}
              pairing={controllerPairing}
              onPair={onPairController}
              onForget={onForgetController}
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
        />
      </div>
      <ConsoleTabs consoles={consoles} activeSystem={activeSystem} onSelect={selectConsole} />
    </div>
  );
}

export default ArcadeShell;
