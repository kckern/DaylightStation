/** Plain application DTO; persistence adapters reconstitute the aggregate separately. */
export function schoolCalcDeviceView(device) {
  return {
    deviceId: device.deviceId,
    label: device.label,
    platformId: device.platformId,
    catalogId: device.catalogId,
    learnerBindings: device.learnerBindings,
    createdAt: device.createdAt,
    lastObservedAt: device.lastObservedAt,
    lastRelayId: device.lastRelayId,
    capabilityReport: device.capabilityReport,
    installedArtifactIds: device.installedArtifactIds,
    desiredArtifactIds: device.desiredArtifactIds,
    deliveryRequests: device.deliveryRequests,
    revision: device.revision,
    hasObserved: device.hasObserved,
  };
}
