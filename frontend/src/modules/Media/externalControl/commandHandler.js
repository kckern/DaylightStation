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
  if (command === 'handoff') {
    // F3a deliberately has wire support only. A browser receipt cannot stand
    // in for the native owner evidence F3b will require.
    return {
      ok: false, reason: 'HANDOFF_UNSUPPORTED', code: 'HANDOFF_UNSUPPORTED',
      handoff: { transferId: params.transferId, phase: 'failed', code: 'HANDOFF_UNSUPPORTED' },
    };
  }
  if (command === 'transport') {
    const { action, value } = params;
    const fn = controller.transport?.[action];
    if (typeof fn !== 'function') return { ok: false, reason: `unknown-transport-action:${action}` };
    if (envelope.origin) controller.setOrigin?.(envelope.origin);
    fn(value);
    return { ok: true };
  }
  if (command === 'queue') {
    if (params.op === 'item-action') {
      if (envelope.origin) controller.setOrigin?.(envelope.origin);
      return controller.execute?.(params) ?? { ok: false, reason: 'Item actions are unavailable', code: 'ITEM_ACTION_UNSUPPORTED' };
    }
    if (params.op === 'undo') {
      if (envelope.origin) controller.setOrigin?.(envelope.origin);
      return controller.undo?.(params.operationId) ?? { ok: false, reason: 'Undo is unavailable', code: 'ITEM_ACTION_UNSUPPORTED' };
    }
    const { op, contentId, queueItemId, clearRest, from, to, items } = params;
    const q = controller.queue;
    const handlers = {
      'play-now': () => q.playNow({ contentId }, { clearRest }),
      'play-next': () => q.playNext({ contentId }),
      'add-up-next': () => q.addUpNext({ contentId }),
      add: () => q.add({ contentId }),
      remove: () => q.remove(queueItemId),
      jump: () => q.jump(queueItemId),
      clear: () => q.clear(),
      reorder: () => q.reorder(items ? { items } : { from, to }),
    };
    if (!handlers[op]) return { ok: false, reason: `unknown-queue-op:${op}` };
    if (envelope.origin) controller.setOrigin?.(envelope.origin);
    handlers[op]();
    return { ok: true };
  }
  if (command === 'config') {
    const { setting, value } = params;
    const c = controller.config;
    const handlers = {
      shuffle: () => c.setShuffle(value),
      repeat: () => c.setRepeat(value),
      shader: () => c.setShader(value),
      volume: () => c.setVolume(value),
    };
    if (!handlers[setting]) return { ok: false, reason: `unknown-config-setting:${setting}` };
    if (envelope.origin) controller.setOrigin?.(envelope.origin);
    handlers[setting]();
    return { ok: true };
  }
  if (command === 'adopt-snapshot') {
    const { snapshot, autoplay = true } = params;
    if (!snapshot) return { ok: false, reason: 'missing-snapshot' };
    if (envelope.origin) controller.setOrigin?.(envelope.origin);
    controller.lifecycle.adoptSnapshot(snapshot, { autoplay });
    return { ok: true };
  }
  return { ok: false, reason: `unhandled-command:${command}` };
}

export default applyCommandEnvelope;
