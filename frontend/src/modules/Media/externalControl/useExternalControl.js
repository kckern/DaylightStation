// frontend/src/modules/Media/externalControl/useExternalControl.js
// Inbound commands targeting this browser's local session (C8.4): subscribe
// to client-control:<clientId>, apply via the shared command handler, ack
// every command on client-ack.
import { useEffect } from 'react';
import { subscribeTopic, publish, topics } from '../net/ws.js';
import { useClientIdentity } from '../identity/useClientIdentity.js';
import { applyCommandEnvelope } from './commandHandler.js';
import mediaLog from '../logging/mediaLog.js';

export function buildClientAck(controlClientId, message, extra) {
  return {
    topic: 'client-ack', clientId: controlClientId,
    replyToControlClientId: message.replyToControlClientId,
    commandId: message.commandId, appliedAt: new Date().toISOString(), ...extra,
  };
}

export function useExternalControl(controller) {
  const { controlClientId, controlReady } = useClientIdentity();

  useEffect(() => {
    if (!controlClientId || !controlReady || !controller) return undefined;
    const topic = topics.clientControl(controlClientId);
    return subscribeTopic(topic, (msg) => {
      const commandId = msg.commandId;
      if (!commandId) return;
      const ack = (extra) => publish(buildClientAck(controlClientId, msg, extra));
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
  }, [controlClientId, controlReady, controller]);
}

export default useExternalControl;
