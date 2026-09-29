// frontend/src/modules/Media/externalControl/commandHandler.js
// Pure: apply a validated CommandEnvelope (§6.2) to a SessionController.
// Shared by external WS control; validation comes from the shared contracts,
// not hand-rolled field checks.
import { validateCommandEnvelope } from '@shared-contracts/media/envelopes.mjs';

function applyWithOrigin(controller, origin, mutate) {
  // Always (re)stage — even to null for a plain human command — not just
  // `if (origin)`. Without this, a human command arriving while an EARLIER
  // routine command's async work is still in flight (its own clearOrigin
  // hasn't run yet) would leave the routine origin ambiently staged, and the
  // controller's own default-origin fallback only fires when nothing is
  // already staged — so the human command would get stamped routine.
  controller.setOrigin?.(origin ?? null);
  const clear = () => controller.clearOrigin?.();
  try {
    const result = mutate();
    if (result?.then) {
      return result.then(
        value => { clear(); return value; },
        error => { clear(); throw error; },
      );
    }
    clear();
    return result;
  } catch (error) {
    clear();
    throw error;
  }
}

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
    applyWithOrigin(controller, envelope.origin, () => fn(value));
    return { ok: true };
  }
  if (command === 'queue') {
    if (params.op === 'item-action') {
      if (typeof controller.execute !== 'function') return { ok: false, reason: 'Item actions are unavailable', code: 'ITEM_ACTION_UNSUPPORTED' };
      return applyWithOrigin(controller, envelope.origin, () => controller.execute(params));
    }
    if (params.op === 'undo') {
      if (typeof controller.undo !== 'function') return { ok: false, reason: 'Undo is unavailable', code: 'ITEM_ACTION_UNSUPPORTED' };
      return applyWithOrigin(controller, envelope.origin, () => controller.undo(params.operationId));
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
    applyWithOrigin(controller, envelope.origin, handlers[op]);
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
    applyWithOrigin(controller, envelope.origin, handlers[setting]);
    return { ok: true };
  }
  if (command === 'adopt-snapshot') {
    const { snapshot, autoplay = true } = params;
    if (!snapshot) return { ok: false, reason: 'missing-snapshot' };
    applyWithOrigin(controller, envelope.origin, () => controller.lifecycle.adoptSnapshot(snapshot, { autoplay }));
    return { ok: true };
  }
  return { ok: false, reason: `unhandled-command:${command}` };
}

export default applyCommandEnvelope;
