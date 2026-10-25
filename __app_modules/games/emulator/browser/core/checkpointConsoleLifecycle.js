import { createCheckpointSession } from './checkpointSession.js';
import { ownCheckpointBytes } from './checkpointClient.js';

/** Own each native result before the next native call can reuse/grow its heap. */
export function captureCheckpoint(engine, saveMode) {
  const state = ownCheckpointBytes(engine?.captureState?.());
  const battery = saveMode === 'battery' ? ownCheckpointBytes(engine?.captureSave?.()) : null;
  if (!state || (saveMode === 'battery' && !battery)) throw Object.assign(new Error('Game progress could not be captured. Your previous save is protected.'), { code: 'ECHECKPOINTINVALID' });
  return { state, battery };
}

/** UI lifecycle boundary; it can retain a recovery decision across an engine reboot. */
export function createCheckpointConsoleLifecycle({ engine: initialEngine, key, saveMode,
  client, journal, makeId, logger, onStateChange, isHeld = () => false } = {}) {
  let engine = initialEngine, held = false, disposed = false, verified = false;
  let localFault = null, exitPromise = null, lastPhase = null, selectedVariant = 'wasm';
  const operations = new Set();
  const session = createCheckpointSession({ key, saveMode, client, journal, makeId, onStateChange: publish });
  function getState() {
    const state = session.getState();
    return { ...state, phase: localFault ? 'error' : state.phase, error: localFault || state.error,
      canSave: state.canSave && !held && !disposed && !localFault,
      canPlay: state.canPlay && !held && !disposed && !localFault };
  }
  function publish() {
    if (disposed) return;
    const state = getState();
    engine?.setProgressPlayable?.(state.canPlay);
    if (!state.canPlay) engine?.pause?.();
    if (state.phase !== lastPhase) {
      lastPhase = state.phase;
      logger?.info?.('emulator.progress.state', { ...key, phase: state.phase, revision: state.revision,
        pendingCount: state.pendingCount, code: state.error?.code ?? null });
    }
    onStateChange?.(state);
  }
  function remember(promise) {
    operations.add(promise);
    const remove = () => operations.delete(promise);
    promise.then(remove, remove);
    return promise;
  }
  function fail(reason) {
    localFault = { status: 'error', code: reason?.code || 'ECHECKPOINTUNAVAILABLE',
      error: reason?.error || reason?.message || 'Could not save progress. Retry before leaving.' };
    held = true; publish();
    logger?.warn?.('emulator.progress.blocked', { ...key, ...localFault });
    return localFault;
  }
  function resume() {
    publish();
    if (getState().canPlay && !isHeld()) engine?.resume?.();
  }
  const capture = () => captureCheckpoint(engine, saveMode);
  function saving({ close = false, retry = false } = {}) {
    try {
      if (close || retry) { held = true; engine?.pause?.(); publish(); }
      const captured = capture();
      const operation = retry && !session.getState().canSave ? session.retry(captured) : session.save(captured);
      return remember(Promise.resolve(operation).then(result => {
        if (result.status === 'error') return fail(result);
        if (result.status === 'skipped') return fail({ code: 'ECHECKPOINTRESTORE', error: 'Reload saved progress to continue.' });
        logger?.info?.('emulator.progress.saved', { ...key, revision: result.data?.head?.revision,
          snapshotHash: result.data?.head?.artifacts?.snapshot?.hash ?? null });
        return result;
      }).catch(fail));
    } catch (reason) { return Promise.resolve(fail(reason)); }
  }
  return {
    getState,
    abortBoot() { verified = false; held = true; publish(); },
    prepare(options = {}) {
      selectedVariant = options.variant || 'wasm';
      return remember(options.claimCapture ? session.prepareClaim(options.claimCapture, options) : session.prepare(options));
    },
    async restore(point) {
      try {
        if (disposed || point?.status !== 'ready') return { status: 'skipped' };
        const proof = await engine.restoreCheckpoint(point.resume);
        if (disposed) return { status: 'skipped' };
        const result = point.recovery ? await session.confirmRecoveryRestored(proof) : session.confirmRestored(proof);
        if (result.status !== 'ok') return fail(result);
        verified = true; localFault = null; held = false;
        logger?.info?.('emulator.progress.restored', { ...key, revision: session.getState().revision,
          artifactHash: proof.artifactHash, requestId: proof.requestId ?? null });
        resume(); return result;
      } catch (reason) { return fail(reason); }
    },
    save() { return getState().canSave ? saving() : Promise.resolve({ status: 'skipped' }); },
    async retry() {
      localFault = null; exitPromise = null;
      const result = await saving({ retry: true });
      if (result.status === 'ok') { verified = true; held = false; resume(); }
      return result;
    },
    exit() {
      if (exitPromise) return exitPromise;
      held = true; engine?.pause?.(); publish();
      exitPromise = !verified ? Promise.resolve({ status: 'ok' }) : saving({ close: true, retry: true });
      exitPromise.then(result => { if (result.status !== 'ok') exitPromise = null; else verified = false; });
      return exitPromise;
    },
    interrupted() {
      if (!verified || disposed) return Promise.resolve({ status: 'skipped' });
      return saving({ close: true, retry: true });
    },
    async reset() {
      try {
        held = true; engine?.pause?.(); publish();
        const result = await remember(session.resetProgress(capture()));
        if (result.status !== 'ok') return fail(result);
        verified = false; return result;
      } catch (reason) { return fail(reason); }
    },
    async resetFromRecovery() {
      held = true; engine?.pause?.(); publish();
      const result = await remember(session.resetFromRecovery());
      if (result.status !== 'ok') return fail(result);
      verified = false; return result;
    },
    async inspectRecovery(options = {}) {
      try {
        held = true; engine?.pause?.(); publish();
        const result = await session.inspectRecovery({ ...options, variant: options.variant || selectedVariant, captured: verified ? capture() : undefined });
        if (result.status === 'ok') { localFault = null; publish(); }
        return result;
      } catch (reason) { return fail(reason); }
    },
    selectRecovery: choice => session.selectRecovery(choice),
    attachEngine(nextEngine) { engine = nextEngine; held = true; verified = false; publish(); },
    detachEngine() { engine = null; },
    dispose() { disposed = true; session.dispose(); engine = null; },
    settled: () => Promise.allSettled([...operations, session.flush()]),
  };
}
