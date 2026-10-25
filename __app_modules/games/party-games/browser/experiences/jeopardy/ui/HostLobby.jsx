import React from 'react';
import TitleCard from '../../../../../../../__capabilities/gaming/browser/platform/ui/TitleCard.jsx';
import CompanionPanel from '../../../../../../../__capabilities/gaming/browser/platform/ui/CompanionPanel.jsx';
export default function HostLobby({sessionId, title}) {
 const url = `${window.location.origin}/party-games/host/${sessionId}`;
 return <div className="jp-host-lobby"><TitleCard title={title} subtitle="Ready to play" /><CompanionPanel title="Host controller" url={url} /><p>Scan with the host’s phone to open the board.</p></div>;
}
