import { useEffect } from 'react';
import { wsService } from '../../../services/WebSocketService.js';
import { useClientIdentity } from '../session/ClientIdentityProvider.jsx';
import { useSessionController } from '../session/useSessionController.js';
import mediaLog from '../logging/mediaLog.js';

function handleCommand(controller, envelope) {
  const { command, params = {} } = envelope;
  if (command === 'transport') {
    const { action, value } = params;
    const fn = controller.transport?.[action];
    if (typeof fn === 'function') fn(value);
  } else if (command === 'queue') {
    const { op, contentId, queueItemId, clearRest, from, to, items } = params;
    const q = controller.queue;
    if (!q) return;
    if (op === 'play-now') q.playNow?.({ contentId }, { clearRest });
    else if (op === 'play-next') q.playNext?.({ contentId });
    else if (op === 'add-up-next') q.addUpNext?.({ contentId });
    else if (op === 'add') q.add?.({ contentId });
    else if (op === 'remove') q.remove?.(queueItemId);
    else if (op === 'jump') q.jump?.(queueItemId);
    else if (op === 'clear') q.clear?.();
    else if (op === 'reorder') q.reorder?.(items ? { items } : { from, to });
  } else if (command === 'config') {
    const { setting, value } = params;
    const c = controller.config;
    if (!c) return;
    if (setting === 'shuffle') c.setShuffle?.(value);
    else if (setting === 'repeat') c.setRepeat?.(value);
    else if (setting === 'shader') c.setShader?.(value);
    else if (setting === 'volume') c.setVolume?.(value);
  } else if (command === 'adopt-snapshot') {
    const { snapshot, autoplay = true } = params;
    if (snapshot) controller.lifecycle?.adoptSnapshot?.(snapshot, { autoplay });
  }
}

export function useExternalControl() {
  const { clientId } = useClientIdentity();
  const controller = useSessionController('local');
  useEffect(() => {
    if (!clientId) return;
    const topic = `client-control:${clientId}`;
    const ackTopic = 'client-ack';
    const unsub = wsService.subscribe(
      (msg) => !!msg && msg.topic === topic,
      (msg) => {
        const commandId = msg.commandId;
        if (!commandId) return;
        try {
          handleCommand(controller, msg);
          mediaLog.externalControlReceived({ commandId, command: msg.command });
          wsService.send({
            topic: ackTopic,
            clientId,
            commandId,
            ok: true,
            appliedAt: new Date().toISOString(),
          });
        } catch (err) {
          mediaLog.externalControlRejected({ commandId, reason: err?.message });
          wsService.send({
            topic: ackTopic,
            clientId,
            commandId,
            ok: false,
            error: err?.message,
            appliedAt: new Date().toISOString(),
          });
        }
      }
    );
    return unsub;
  }, [clientId, controller]);
}

export default useExternalControl;
