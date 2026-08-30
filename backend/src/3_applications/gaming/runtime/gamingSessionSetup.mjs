import { GamingKernelError } from '#shared/gaming/kernel/index.mjs';

export function authorizeGamingSessionCreation({ viewer, participants = [], seats = [] }) {
  if (!viewer) throw new GamingKernelError('authorization_denied', 'A session creator identity is required');
  if (viewer.role !== 'host' && (participants.length === 0
    || participants.some((participant) => String(participant.id || participant.user_id || '') !== viewer.participant_id)
    || seats.length > 0)) {
    throw new GamingKernelError('authorization_denied', 'Participants may create only an unseated session for themselves');
  }
}

export function prepareGamingSessionSetup({ manifest, request, partyGamesCatalog = null }) {
  const participants = request.participants || [];
  const seats = request.seats || [];
  const setup = structuredClone(request.setup || {});
  const setupKind = manifest.setup?.kind || 'none';
  if (setupKind === 'individuals' && participants.length === 0) throw new GamingKernelError('invalid_session_setup', 'This experience requires participants');
  if (setupKind === 'teams' && seats.length === 0) throw new GamingKernelError('invalid_session_setup', 'This experience requires team seats');
  if (setupKind === 'individuals-or-teams' && participants.length === 0 && seats.length === 0) throw new GamingKernelError('invalid_session_setup', 'This experience requires participants or team seats');
  const seatIds = seats.map((seat) => seat?.id).filter(Boolean).map(String);
  if (seatIds.length !== seats.length || new Set(seatIds).size !== seats.length) throw new GamingKernelError('invalid_session_setup', 'Session seats require unique IDs');
  const allowedHostModes = manifest.setup?.host_modes || [];
  if (setup.host?.mode && !allowedHostModes.includes(setup.host.mode)) {
    throw new GamingKernelError('invalid_session_setup', `Host mode ${setup.host.mode} is not allowed by the experience manifest`);
  }
  if (manifest.setup?.verifier === 'opponent' && setup.host?.mode && setup.host.mode !== 'human' && !setup.verifier_id) {
    throw new GamingKernelError('invalid_session_setup', 'This host mode requires an opponent verifier');
  }
  if (manifest.setup?.candidate_source === 'household-members') {
    if (!partyGamesCatalog) throw new GamingKernelError('invalid_session_setup', 'Household candidates require the Party Games environment');
    setup.candidates = partyGamesCatalog.getConfig().household_members;
  }
  return { participants, seats, setup };
}
