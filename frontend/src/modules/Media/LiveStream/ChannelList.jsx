// frontend/src/modules/Media/LiveStream/ChannelList.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import DJBoard from './DJBoard.jsx';
import './LiveStream.scss';

const ChannelList = () => {
  const [channels, setChannels] = useState([]);
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [newName, setNewName] = useState('');

  const refresh = useCallback(async () => {
    const data = await DaylightAPI('/api/v1/livestream/channels');
    setChannels(data.channels || []);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const createChannel = async () => {
    if (!newName.trim()) return;
    await DaylightAPI('/api/v1/livestream/channels', { name: newName.trim() }, 'POST');
    setNewName('');
    refresh();
  };

  const deleteChannel = async (name, e) => {
    e.stopPropagation();
    await DaylightAPI(`/api/v1/livestream/${name}`, {}, 'DELETE');
    refresh();
  };

  if (selectedChannel) {
    return <DJBoard channel={selectedChannel} onBack={() => { setSelectedChannel(null); refresh(); }} />;
  }

  return (
    <div className="livestream-channels">
      {channels.map(ch => (
        <div key={ch.name} className="channel-card" onClick={() => setSelectedChannel(ch.name)}>
          <div className="channel-info">
            <div className="channel-name">{ch.name}</div>
            <div className="channel-status">{ch.status}{ch.activeProgram ? ` — ${ch.activeProgram}` : ''}</div>
            {ch.currentTrack && <div className="channel-track">{ch.currentTrack.split('/').pop()}</div>}
          </div>
          <div className="channel-listeners">{ch.listenerCount} listeners</div>
          <button className="channel-delete" onClick={(e) => deleteChannel(ch.name, e)}>Delete</button>
        </div>
      ))}

      <div className="create-channel">
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="New channel name..."
          onKeyDown={e => e.key === 'Enter' && createChannel()}
        />
        <button onClick={createChannel}>Create</button>
      </div>
    </div>
  );
};

export default ChannelList;
