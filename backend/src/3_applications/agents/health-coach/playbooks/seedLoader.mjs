/**
 * Populate empty working memory through an injected seed-reader port.
 * Reading package files is adapter work; this use case only applies the
 * resulting playbooks while preserving the existing no-overwrite behavior.
 */
export async function loadSeedIfEmpty(memory, { seedReader } = {}) {
  const existing = memory.get('playbooks');
  if (Array.isArray(existing) && existing.length > 0) return { loaded: false };
  if (!seedReader || typeof seedReader.read !== 'function') {
    throw new Error('loadSeedIfEmpty requires a seedReader');
  }
  const seed = await seedReader.read();
  memory.set('playbooks', seed);
  return { loaded: true, count: seed.length };
}
