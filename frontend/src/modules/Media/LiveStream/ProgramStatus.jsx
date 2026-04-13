// frontend/src/modules/Media/LiveStream/ProgramStatus.jsx
import React from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';

const ProgramStatus = ({ channel, status, onUpdate }) => {
  if (!status.activeProgram) return null;

  const sendInput = async (choice) => {
    await DaylightAPI(`/api/v1/livestream/${channel}/input/${choice}`, {}, 'POST');
    onUpdate?.();
  };

  return (
    <div className="program-status">
      <div className="program-name">Program: {status.activeProgram}</div>
      {status.waitingForInput && (
        <>
          <div className="program-state">Waiting for input...</div>
          <div className="input-buttons">
            {['a', 'b', 'c', 'd'].map(choice => (
              <button key={choice} onClick={() => sendInput(choice)}>
                {choice.toUpperCase()}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default ProgramStatus;
