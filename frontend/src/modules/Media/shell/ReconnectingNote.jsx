// frontend/src/modules/Media/shell/ReconnectingNote.jsx
// RELY.7a/AC4 — a brief network hiccup never reloads /media (MediaApp
// suppresses the WebSocket auto-reload) and shows nothing; a loss that lasts
// past the grace period shows one quiet "Reconnecting…" note, cleared the
// moment the connection returns. Playback and navigation are untouched.
import React, { useEffect, useRef, useState } from 'react';
import { onStatus } from '../net/ws.js';
import mediaLog from '../logging/mediaLog.js';

export const RECONNECTING_GRACE_MS = 3_000;

export function ReconnectingNote() {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef(null);
  const shownRef = useRef(false);
  useEffect(() => {
    const clearTimer = () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } };
    const off = onStatus((status) => {
      if (status?.connected === false) {
        if (timerRef.current || shownRef.current) return;
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          shownRef.current = true;
          mediaLog.reconnectingShown({ graceMs: RECONNECTING_GRACE_MS });
          setVisible(true);
        }, RECONNECTING_GRACE_MS);
      } else if (status?.connected === true) {
        clearTimer();
        if (shownRef.current) mediaLog.reconnectingCleared({});
        shownRef.current = false;
        setVisible(false);
      }
    });
    return () => { clearTimer(); off?.(); };
  }, []);
  if (!visible) return null;
  return (
    <div className="media-reconnecting" data-testid="media-reconnecting" role="status">
      Reconnecting…
    </div>
  );
}

export default ReconnectingNote;
