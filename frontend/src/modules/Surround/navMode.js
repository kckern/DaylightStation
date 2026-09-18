/**
 * NAV MODE — the selection state for a navigable rail.
 *
 * Pure by design: no React, no DOM, no timers. The rail renders it, the
 * Player's key handler advances it, and neither owns it. That is what lets the
 * module contract stay read-only — the state travels as a DOM CustomEvent in
 * one direction and a seek in the other, exactly as `surround-seek` already does.
 *
 * WHY UP-PAST-THE-TOP EXITS. FKB swallows Esc on the Shield, and the remote has
 * only a D-pad and OK, so every state must be escapable from those four keys
 * alone. Up is the one direction that has a natural edge to fall off.
 */

/** The DOM event the Player dispatches and the rail listens for. */
export const SURROUND_NAV_EVENT = 'surround-nav';

/** Leave nav mode after this long without a key. Matches the footer-zoom grace. */
export const NAV_IDLE_MS = 12000;

/** Not in nav mode. */
export const navInitial = null;

const groupAt = (world, groupIndex) => (Array.isArray(world?.groups)
  ? world.groups.find((g) => g.index === groupIndex) ?? null
  : null);

const firstRowOf = (group) => (group ? group.from : 0);
const lastRowOf = (group) => (group ? group.from + group.count - 1 : 0);

/**
 * @param {{groupIndex:number,rowIndex:number}|null} state
 * @param {'enter'|'up'|'down'|'left'|'right'|'select'|'exit'} action
 * @param {{groups:Array<{index:number,from:number,count:number}>,
 *          soundingGroupIndex:number|null, soundingRowIndex:number}} world
 * @returns {{groupIndex:number,rowIndex:number}|null}
 */
export function navReduce(state, action, world) {
  const groups = Array.isArray(world?.groups) ? world.groups : [];
  if (groups.length === 0) return null;

  if (action === 'enter') {
    // The sounding row, so the first press lands where the viewer already is.
    // In a gap nothing is sounding, and the top of the rail is the honest answer.
    const gi = Number.isFinite(world?.soundingGroupIndex) && world.soundingGroupIndex !== null
      ? world.soundingGroupIndex : groups[0].index;
    const group = groupAt(world, gi) ?? groups[0];
    const row = world?.soundingRowIndex >= 0 ? world.soundingRowIndex : firstRowOf(group);
    return { groupIndex: group.index, rowIndex: row };
  }

  if (!state) return null;
  if (action === 'select' || action === 'exit') return null;

  const here = groupAt(world, state.groupIndex) ?? groups[0];
  const at = groups.indexOf(here);

  if (action === 'down') {
    // Held at the group's last row rather than leaking into the next group:
    // moving between groups is what left/right is for, and a Down that silently
    // changed act would make the chip row lie about what is selected.
    return { ...state, rowIndex: Math.min(state.rowIndex + 1, lastRowOf(here)) };
  }

  if (action === 'up') {
    // THE EXIT. Past the first row there is nowhere above to go, so nav mode
    // ends and the arrows go back to the Player.
    if (state.rowIndex <= firstRowOf(here)) return null;
    return { ...state, rowIndex: state.rowIndex - 1 };
  }

  if (action === 'left' || action === 'right') {
    const next = groups[Math.max(0, Math.min(groups.length - 1, at + (action === 'right' ? 1 : -1)))];
    // Previewing only. The playhead does not move until OK.
    return { groupIndex: next.index, rowIndex: firstRowOf(next) };
  }

  return state;
}

/**
 * The row a `select` should seek to.
 * @returns {number|null} row index, or null when not in nav mode.
 */
export function navSeekTarget(state, world) {
  if (!state) return null;
  const groups = Array.isArray(world?.groups) ? world.groups : [];
  if (groups.length === 0) return null;
  return state.rowIndex;
}
