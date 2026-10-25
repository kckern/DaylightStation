import React from 'react';
import TitleCard from '../../../../../../../__capabilities/gaming/browser/platform/ui/TitleCard.jsx';
import CompanionPanel from '../../../../../../../__capabilities/gaming/browser/platform/ui/CompanionPanel.jsx';
import BuzzerStatus from "./BuzzerStatus.jsx";
export default function HostLobby({sessionId, title, state, teams}) {
 const url = `${window.location.origin}/party-games/host/${sessionId}`;
 return <div className="jp-host-lobby" data-testid="host-lobby"><TitleCard title={title} subtitle="Ready to play" /><CompanionPanel title="Scan to host" url={url} size={192} /><BuzzerStatus state={state} teams={teams} /><p>Start the game on your phone.</p><p role="status">Waiting for the host to start…</p></div>;
}
