/** Persisted v1 YAML projection for the HealthArchiveManifest domain entity. */
export function encodeHealthArchiveManifest(manifest) {
  return {
    manifest_version: 1,
    user_id: manifest.userId,
    category: manifest.category,
    last_sync: manifest.lastSync,
    source_locations: manifest.sourceLocations,
    schema_versions: manifest.schemaVersions,
    record_counts: manifest.recordCounts,
  };
}
