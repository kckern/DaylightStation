/** @typedef {import('./application/participants/ParticipantPorts.mjs').IParticipantContextProvider} IParticipantContextProvider */
/** @typedef {import('./application/participants/ParticipantPorts.mjs').IParticipantConsumer} IParticipantConsumer */
/** @typedef {import('./application/participants/ParticipantPorts.mjs').IParticipantLaunchStore} IParticipantLaunchStore */
/** @typedef {import('./application/participants/ParticipantPorts.mjs').ParticipantConsumerDescriptor} ParticipantConsumerDescriptor */
/** @typedef {import('./application/participants/ParticipantPorts.mjs').ParticipantLaunchSnapshot} ParticipantLaunchSnapshot */
/** @typedef {import('./application/participants/ParticipantPorts.mjs').ParticipantLaunchResult} ParticipantLaunchResult */
/** @typedef {import('./application/participants/ParticipantPorts.mjs').PreparedParticipantSetup} PreparedParticipantSetup */
/** @typedef {import('./application/participants/ParticipantPorts.mjs').LaunchReceipt} LaunchReceipt */
/** @typedef {import('./application/participants/ParticipantPorts.mjs').ParticipantLaunchAccess} ParticipantLaunchAccess */
/** @typedef {import('./application/participants/ParticipantPorts.mjs').ReservationInput} ReservationInput */
/** @typedef {import('./application/participants/ParticipantPorts.mjs').SnapshotBuild} SnapshotBuild */
/** @typedef {import('./application/participants/ParticipantPorts.mjs').ReservedLaunch} ReservedLaunch */
/** @typedef {import('./application/participants/ParticipantPorts.mjs').RetainedLaunch} RetainedLaunch */
/** @typedef {import('./application/participants/ParticipantPorts.mjs').ConsumerRef} ConsumerRef */
/** @typedef {import('./application/participants/ParticipantPorts.mjs').ArtifactRef} ArtifactRef */
/** @typedef {import('./application/participants/ParticipantPorts.mjs').VersionedPayload} VersionedPayload */
/** @typedef {import('./application/participants/ParticipantPorts.mjs').RuntimeRef} RuntimeRef */
/** @typedef {import('./application/participants/ParticipantPorts.mjs').SafeReturnTarget} SafeReturnTarget */
/** @typedef {import('./application/participants/ParticipantPorts.mjs').ReadyResult} ReadyResult */
/** @typedef {import('./application/participants/ParticipantPorts.mjs').ActionTargetMatcher} ActionTargetMatcher */
/** Register retainedOnly versions for exact historical lookup without new-operation matching. */
export { ParticipantConsumerRegistry } from './application/participants/ParticipantConsumerRegistry.mjs';
export { ParticipantSetupResolver, hashValue } from './application/participants/ParticipantSetupResolver.mjs';
export { ParticipantLaunchService } from './application/participants/ParticipantLaunchService.mjs';
