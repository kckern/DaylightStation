import React from 'react';
import TitleCard from '../../../../../../../__capabilities/gaming/browser/platform/ui/TitleCard.jsx';
import CompanionPanel from '../../../../../../../__capabilities/gaming/browser/platform/ui/CompanionPanel.jsx';
import BuzzerStatus from "./BuzzerStatus.jsx";
export default function HostLobby({sessionId, title, state, teams, hardware}) {
 const url = `${window.location.origin}/party-games/host/${sessionId}`;
 return <div className="jp-host-lobby" data-testid="host-lobby"><TitleCard title={title} subtitle="Ready to play" /><div className="jp-host-lobby__columns"><CompanionPanel title="Scan to host" url={url} size={164} /><BuzzerStatus state={state} teams={teams} hardware={hardware} /></div></div>;
}
