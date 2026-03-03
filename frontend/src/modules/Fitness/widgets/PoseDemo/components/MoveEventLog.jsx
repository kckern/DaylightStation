/**
 * MoveEventLog - Displays a log of recent move detection events
 */

import React, { useEffect, useRef } from 'react';

const MoveEventLog = ({ events = [], maxItems = 10 }) => {
  const listRef = useRef(null);
  
  // Auto-scroll to bottom
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [events]);
  
  if (!events || events.length === 0) {
    return (
      <div className="move-event-log empty">
        <span className="empty-text">No move events detected</span>
      </div>
    );
  }
  
  const displayEvents = events.slice(-maxItems);
  
  return (
    <div className="move-event-log">
      <div className="log-header">Move Events</div>
      <div className="log-list" ref={listRef}>
        {displayEvents.map((event, index) => (
          <div key={`${event.timestamp}-${index}`} className="log-item">
            <span className="log-time">
              {new Date(event.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
            <span className={`log-type type-${event.type}`}>
              {event.type === 'rep_counted' ? '🔄' : 
               event.type === 'state_change' ? '➡️' : 'ℹ️'}
            </span>
            <div className="log-details">
              <span className="log-detector">{event.detectorId}</span>
              {event.type === 'rep_counted' && (
                <span className="log-value">Rep #{event.data.repCount}</span>
              )}
              {event.type === 'state_change' && (
                <span className="log-value">{event.data.fromState} → {event.data.toState}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MoveEventLog;
