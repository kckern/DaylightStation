/** "Turn off both", "Turn off all 3" — the room's lamps, never the house's. */
export function turnOffLabel(n) {
  return n === 2 ? 'Turn off both' : `Turn off all ${n}`;
}

export default turnOffLabel;
