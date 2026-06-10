// frontend/src/modules/Media/externalControl/useExternalControl.js
// Inbound commands targeting this browser's local session (C8.4): subscribe
// to client-control:<clientId>, apply via the shared command handler, ack
// every command on client-ack.
import { useEffect } from 'react';
import { subscribeTopic, publish, topics } from '../net/ws.js';
import { useClientIdentity } from '../identity/ClientIdentityProvider.jsx';
import { applyCommandEnvelope } from './commandHandler.js';
import mediaLog from '../logging/mediaLog.js';

export function useExternalControl(controller) {
  const { clientId } = useClientIdentity();

  useEffect(() => {
    if (!clientId || !controller) return undefined;
    const topic = topics.clientControl(clientId);
    return subscribeTopic(topic, (msg) => {
      const commandId = msg.commandId;
      if (!commandId) return;
      const ack = (extra) => publish({
        topic: 'client-ack',
        clientId,
        commandId,
        appliedAt: new Date().toISOString(),
        ...extra,
      });
      try {
        const result = applyCommandEnvelope(controller, msg);
        if (result.ok) {
          mediaLog.externalControlReceived({ commandId, command: msg.command });
          ack({ ok: true });
        } else {
          mediaLog.externalControlRejected({ commandId, reason: result.reason });
          ack({ ok: false, error: result.reason });
        }
      } catch (err) {
        mediaLog.externalControlRejected({ commandId, reason: err?.message });
        ack({ ok: false, error: err?.message });
      }
    });
  }, [clientId, controller]);
}

export default useExternalControl;
