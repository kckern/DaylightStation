/** Build metadata is declared evidence, not deployed-artifact verification. */
export function createSchoolLifecycleLogger({ rootLogger, buildMetadataSource }) {
  return rootLogger.child({ module: 'school-lifecycle', buildIdentity: buildMetadataSource.diagnosticIdentity() });
}
