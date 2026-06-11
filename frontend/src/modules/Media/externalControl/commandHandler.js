// frontend/src/modules/Media/externalControl/commandHandler.js
// Pure: apply a validated CommandEnvelope (§6.2) to a SessionController.
// Shared by external WS control; validation comes from the shared contracts,
// not hand-rolled field checks.
import { validateCommandEnvelope } from '@shared-contracts/media/envelopes.mjs';

/**
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function applyCommandEnvelope(controller, envelope) {
  const validation = validateCommandEnvelope(envelope);
  if (!validation.valid) {
    return { ok: false, reason: validation.errors?.join('; ') || 'invalid-envelope' };
  }

  const { command, params = {} } = envelope;
  if (command === 'transport') {
    const { action, value } = params;
    const fn = controller.transport?.[action];
    if (typeof fn !== 'function') return { ok: false, reason: `unknown-transport-action:${action}` };
    fn(value);
    return { ok: true };
  }
  if (command === 'queue') {
    const { op, contentId, queueItemId, clearRest, from, to, items } = params;
    const q = controller.queue;
    if (op === 'play-now') q.playNow({ contentId }, { clearRest });
    else if (op === 'play-next') q.playNext({ contentId });
    else if (op === 'add-up-next') q.addUpNext({ contentId });
    else if (op === 'add') q.add({ contentId });
    else if (op === 'remove') q.remove(queueItemId);
    else if (op === 'jump') q.jump(queueItemId);
    else if (op === 'clear') q.clear();
    else if (op === 'reorder') q.reorder(items ? { items } : { from, to });
    else return { ok: false, reason: `unknown-queue-op:${op}` };
    return { ok: true };
  }
  if (command === 'config') {
    const { setting, value } = params;
    const c = controller.config;
    if (setting === 'shuffle') c.setShuffle(value);
    else if (setting === 'repeat') c.setRepeat(value);
    else if (setting === 'shader') c.setShader(value);
    else if (setting === 'volume') c.setVolume(value);
    else return { ok: false, reason: `unknown-config-setting:${setting}` };
    return { ok: true };
  }
  if (command === 'adopt-snapshot') {
    const { snapshot, autoplay = true } = params;
    if (!snapshot) return { ok: false, reason: 'missing-snapshot' };
    controller.lifecycle.adoptSnapshot(snapshot, { autoplay });
    return { ok: true };
  }
  return { ok: false, reason: `unhandled-command:${command}` };
}

export default applyCommandEnvelope;
