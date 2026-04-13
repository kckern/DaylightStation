// frontend/src/modules/Media/LiveStream/DJBoard.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import ProgramStatus from './ProgramStatus.jsx';

const DJBoard = ({ channel, onBack }) => {
  const [status, setStatus] = useState(null);

  const refresh = useCallback(async () => {
    const data = await DaylightAPI(`/api/v1/livestream/${channel}`);
    setStatus(data);
  }, [channel]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'bus_command', action: 'subscribe', topics: [`livestream:${channel}`] }));
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.topic === `livestream:${channel}`) setStatus(msg);
      } catch {}
    };
    return () => ws.close();
  }, [channel]);

  const queueFile = async () => {
    const file = prompt('File path:');
    if (file) {
      await DaylightAPI(`/api/v1/livestream/${channel}/queue`, { files: [file] }, 'POST');
      refresh();
    }
  };

  const forcePlay = async (file) => {
    await DaylightAPI(`/api/v1/livestream/${channel}/force`, { file }, 'POST');
    refresh();
  };

  const skip = async () => {
    await DaylightAPI(`/api/v1/livestream/${channel}/skip`, {}, 'POST');
    refresh();
  };

  const stop = async () => {
    await DaylightAPI(`/api/v1/livestream/${channel}/stop`, {}, 'POST');
    refresh();
  };

  const removeFromQueue = async (index) => {
    await DaylightAPI(`/api/v1/livestream/${channel}/queue/${index}`, {}, 'DELETE');
    refresh();
  };

  if (!status) return <div className="djboard">Loading...</div>;

  const soundboard = status.soundboard || [];

  return (
    <div className="djboard">
      <div className="djboard-soundboard">
        <button className="back-btn" onClick={onBack}>Back to channels</button>

        {soundboard.length > 0 && (
          <div className="soundboard-grid">
            {soundboard.map((btn, i) => (
              <button
                key={i}
                className="sound-btn"
                onClick={() => btn.force ? forcePlay(btn.file) : queueFile(btn.file)}
              >
                {btn.label}
              </button>
            ))}
          </div>
        )}

        <div className="transport">
          <button onClick={stop}>Stop</button>
          <button onClick={skip}>Skip</button>
          <button onClick={queueFile}>+ Add</button>
        </div>

        <ProgramStatus channel={channel} status={status} onUpdate={refresh} />
      </div>

      <div className="djboard-queue">
        {status.currentTrack ? (
          <div className="now-playing">
            <div className="track-name">Now: {status.currentTrack.split('/').pop()}</div>
          </div>
        ) : (
          <div className="now-playing">
            <div className="track-name">Idle — ambient</div>
          </div>
        )}

        {status.queue?.map((file, i) => (
          <div key={i} className="queue-item">
            <span>{i + 1}. {file.split('/').pop()}</span>
            <button className="remove-btn" onClick={() => removeFromQueue(i)}>x</button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DJBoard;
