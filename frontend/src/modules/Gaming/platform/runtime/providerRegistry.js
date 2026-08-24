export function createProviderRegistry(providers = []) {
  const entries = new Map();
  for (const provider of providers) {
    if (!provider?.id || typeof provider.createRuntime !== 'function') throw new Error('Invalid challenge provider');
    if (entries.has(provider.id)) throw new Error(`Duplicate challenge provider: ${provider.id}`);
    entries.set(provider.id, provider);
  }
  return {
    get(id) { return entries.get(id) || null; },
    ids() { return [...entries.keys()]; },
  };
}
