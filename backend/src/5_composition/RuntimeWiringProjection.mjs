/** Small composition projections derived solely from dependencies wired at boot. */
export class RuntimeWiringProjection {
  compact(values) { return values.filter(Boolean); }

  configuredCapabilities(registry, capabilities) {
    return registry?.providers ? capabilities.filter((capability) => registry.has(capability)) : [];
  }

  feedFilters(sourceAdapters, queryConfigs) {
    return {
      sourceTypes: sourceAdapters.map((adapter) => adapter.sourceType),
      queryNames: queryConfigs.map((query) => query.key).filter(Boolean),
    };
  }

  printerSummary(printers) {
    return printers
      .map((printer) => `${printer.name} (${printer.host}:${printer.port}${printer.isDefault ? ', default' : ''})`)
      .join(', ');
  }
}

export default RuntimeWiringProjection;
