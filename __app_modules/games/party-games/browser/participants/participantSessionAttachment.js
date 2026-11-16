import {validateParticipantContext} from '../../../../../__capabilities/household-identity/portable/participants.mjs';

/** Validate a ready result against the Gaming session it actually references. */
export function participantSessionAttachment({participantLaunch, explicitSession, sessionHeader}) {
  const metadata = sessionHeader?.launch?.participant_launch;
  const definition = sessionHeader?.artifacts?.rules_definition?.id;
  if (!sessionHeader?.session_id || (explicitSession && explicitSession !== sessionHeader.session_id)) throw Error('Attached session identity does not match');
  if (metadata && (metadata.schema !== 'participant-session-attachment/v1' || (metadata.source_ref && (metadata.source_ref.schema !== 'participant-launch-ref/v1' || !metadata.source_ref.provider || !metadata.source_ref.ref)) || !metadata.launch_id || !metadata.snapshot_hash)) throw Error('Invalid participant session metadata');
  if (participantLaunch) {
    const data = participantLaunch.output?.data;
    if (participantLaunch.schema !== 'participant-launch-result/v1' || participantLaunch.kind !== 'ready' || participantLaunch.consumer?.id !== 'party-games' || participantLaunch.consumer?.version !== 1 || participantLaunch.output?.schema !== 'party-games-launch-result/v1' || !data?.session_id || !data?.definition_id || participantLaunch.runtime_ref?.provider !== 'gaming' || participantLaunch.runtime_ref.id !== data.session_id || data.session_id !== sessionHeader.session_id || data.definition_id !== definition || !metadata || metadata.launch_id !== participantLaunch.launch_id || metadata.snapshot_hash !== participantLaunch.snapshot_hash || metadata.consumer?.id !== 'party-games' || metadata.consumer?.version !== 1) throw Error('Participant launch does not match attached session');
    validateParticipantContext(participantLaunch.participant_context);
    const expected = participantLaunch.participant_context.participants.map(p => ({id:p.participant_id,name:p.display.name,avatar:p.display.avatar,identity:p.identity}));
    const actual = sessionHeader.participants?.map(p => ({id:p.id,name:p.name,avatar:p.avatar,identity:p.identity}));
    if (!expected || !actual || JSON.stringify(expected) !== JSON.stringify(actual)) throw Error('Participant launch roster does not match attached session');
  }
  return {sessionId:sessionHeader.session_id, definitionId:definition, returnTo:metadata?.return_to || null};
}
