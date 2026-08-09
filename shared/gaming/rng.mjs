/** Mulberry32: small, deterministic, and stable for recorded schema-v1 seeds. */
export function nextRandom(rngState) {
  const nextState = (Number(rngState) + 0x6D2B79F5) >>> 0;
  let t = nextState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { state: nextState, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}

export function shuffle(items, seed) {
  const output = [...items];
  let rngState = Number(seed) >>> 0;
  for (let i = output.length - 1; i > 0; i -= 1) {
    const next = nextRandom(rngState);
    rngState = next.state;
    const j = Math.floor(next.value * (i + 1));
    [output[i], output[j]] = [output[j], output[i]];
  }
  return { items: output, rngState };
}
