import React, { useEffect, useState } from 'react';
import { useWebSocketSubscription } from '@/hooks/useWebSocket.js';

export default function EffectOverlay({ sessionId }) {
  const [effect, setEffect] = useState(null);
  useWebSocketSubscription('gaming', (message) => { if (message?.kind === 'effect' && message.sessionId === sessionId) setEffect(message.effect); }, [sessionId]);
  useEffect(() => { if (!effect) return undefined; const id = setTimeout(() => setEffect(null), 5_000); return () => clearTimeout(id); }, [effect]);
  if (!effect) return null;
  const content = effect.type === 'ai.judgment-proposal'
    ? `${effect.proposal?.recommendation || 'abstain'} — ${effect.proposal?.reason || 'No reason supplied'}`
    : effect.content;
  return <aside className={`group-play-effect group-play-effect--${effect.type.replaceAll('.', '-')}`} aria-live="polite"><strong>{effect.type === 'ai.judgment-proposal' ? 'AI suggestion' : 'Host commentary'}</strong><span>{content}</span></aside>;
}
