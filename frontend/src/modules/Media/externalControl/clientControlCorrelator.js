import { CLIENT_ACK_TOPIC, CLIENT_CONTROL_TOPIC } from '@shared-contracts/media/topics.mjs';

export function createClientControlCorrelator({ controlClientId, service, timeoutMs = 10_000 }) {
  const pending = new Map();
  const failAll = (reason) => {
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(new Error(reason)); }
    pending.clear();
  };
  const unsubscribe = service.subscribe((message) => message?.topic === CLIENT_ACK_TOPIC(controlClientId), (ack) => {
    const entry = pending.get(ack?.commandId);
    if (!entry || ack.clientId !== entry.targetControlClientId) return;
    clearTimeout(entry.timer); pending.delete(ack.commandId); entry.resolve(ack);
  });
  const unsubscribeStatus = service.onStatusChange((status) => {
    if (status?.connected === false) failAll('control-disconnect');
  });
  return {
    send({ targetControlClientId, command }) {
      if (!targetControlClientId || !command?.commandId) return Promise.reject(new Error('control-invalid-command'));
      if (pending.has(command.commandId)) return Promise.reject(new Error('control-duplicate-commandId'));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(command.commandId); reject(new Error('control-timeout')); }, timeoutMs);
        pending.set(command.commandId, { targetControlClientId, resolve, reject, timer });
        const sent = service.sendEphemeral({ ...command, topic: CLIENT_CONTROL_TOPIC(targetControlClientId), replyToControlClientId: controlClientId });
        if (!sent) { clearTimeout(timer); pending.delete(command.commandId); reject(new Error('control-unavailable')); }
      });
    },
    dispose() { failAll('control-disposed'); unsubscribe?.(); unsubscribeStatus?.(); },
  };
}
