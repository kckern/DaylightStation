// Only a coordinator may populate entries, after validating durable history.
export class VerifiedSessionCache {
  constructor({ maxEntries = 32 } = {}) { this.maxEntries = maxEntries; this.entries = new Map(); }
  get(id, versions) {
    const entry = this.entries.get(id);
    if (!entry || !versions || entry.journalVersion !== versions.journalVersion || entry.snapshotVersion !== versions.snapshotVersion) {
      this.invalidate(id); return null;
    }
    this.entries.delete(id); this.entries.set(id, entry); return entry;
  }
  set(id, entry) {
    this.entries.delete(id); this.entries.set(id, structuredClone(entry));
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
  }
  invalidate(id) { this.entries.delete(id); }
}
