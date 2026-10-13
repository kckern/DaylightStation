export class ExperienceRegistry {
  constructor(manifests = []) { this.manifests = new Map(); manifests.forEach((manifest) => this.register(manifest)); }
  register(manifest) { if (this.manifests.has(manifest.id)) throw new Error(`Duplicate experience: ${manifest.id}`); this.manifests.set(manifest.id, manifest); return () => this.manifests.delete(manifest.id); }
  get(id) { return this.manifests.get(id) || null; }
  list({ surfaceId = null } = {}) { return [...this.manifests.values()].filter((manifest) => !surfaceId || manifest.surfaces?.some((surface) => surface.id === surfaceId)); }
}
