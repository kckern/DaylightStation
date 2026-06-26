/**
 * ArcadeShell — the "Video Games" welcome screen: a centered grid of game
 * covers with console tabs across the bottom.
 *
 * Host-agnostic and presentation-only: the library data and the launch/exit
 * handlers are injected. Owns grid focus + keyboard/gamepad navigation; the
 * actual launch flow (fingerprint, save/resume) lives in the host widget.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { GameGrid } from './GameGrid.jsx';
import { ConsoleTabs } from './ConsoleTabs.jsx';
import { useArcadeInput } from './useArcadeInput.js';
import { nextGridIndex } from './gridNav.js';
import './ArcadeShell.scss';

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
}) {
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

  return (
    <div className="emu-arcade-shell">
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
