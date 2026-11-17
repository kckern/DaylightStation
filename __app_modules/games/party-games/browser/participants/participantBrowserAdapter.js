import React from 'react';
import PartyGamesApp from '../app/PartyGamesApp.jsx';

export function PartyGamesParticipantAdapter({participantLaunch, clear}) {
  const data = participantLaunch?.output?.data;
  if (participantLaunch?.schema !== 'participant-launch-result/v1' || participantLaunch.kind !== 'ready' || participantLaunch.consumer?.id !== 'party-games' || participantLaunch.consumer?.version !== 1 || participantLaunch.output?.schema !== 'party-games-launch-result/v1' || typeof participantLaunch.launch_id !== 'string' || !participantLaunch.launch_id || typeof participantLaunch.snapshot_hash !== 'string' || !participantLaunch.snapshot_hash || typeof data?.session_id !== 'string' || !data.session_id || typeof data.definition_id !== 'string' || !data.definition_id || participantLaunch.runtime_ref?.provider !== 'gaming' || participantLaunch.runtime_ref.id !== data.session_id) {
    return React.createElement('div', {role:'alert'}, 'Party Games launch unavailable', React.createElement('button', {onClick:clear}, 'Back'));
  }
  return React.createElement(PartyGamesApp, {participantLaunch, clear});
}

export function PartyGamesParticipantPassthrough({action, target, clear}) {
  if (action !== 'open' || target?.kind !== 'app' || target.appId !== 'party-games' || target.surfaceId !== 'party-games' || typeof target.definitionId !== 'string') {
    return React.createElement('div', {role:'alert'}, 'Party Games launch unavailable');
  }
  return React.createElement(PartyGamesApp, {definitionId:target.definitionId, clear});
}
