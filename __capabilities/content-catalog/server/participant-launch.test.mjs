import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { ParticipantConsumerRegistry } from './participant-launch.mjs';

it('exposes application contract typedefs through the owner entry', () => {
  const entry = readFileSync(new URL('./participant-launch.mjs', import.meta.url), 'utf8');
  const ports = readFileSync(new URL('./application/participants/ParticipantPorts.mjs', import.meta.url), 'utf8');
  for (const name of ['IParticipantContextProvider','IParticipantConsumer','IParticipantLaunchStore','ParticipantConsumerDescriptor','ParticipantLaunchSnapshot','ParticipantLaunchResult','PreparedParticipantSetup','LaunchReceipt','ParticipantLaunchAccess','ReservationInput','SnapshotBuild','ReservedLaunch','RetainedLaunch','ConsumerRef','ArtifactRef','VersionedPayload','RuntimeRef','SafeReturnTarget','ReadyResult','ActionTargetMatcher']) {
    expect(entry).toContain(`@typedef {import('./application/participants/ParticipantPorts.mjs').${name}} ${name}`);
    expect(ports).toMatch(new RegExp(`\\}\\s+${name}(?:\\s|$)`));
  }
  expect(typeof ParticipantConsumerRegistry).toBe('function');
});
