import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────
const log = vi.hoisted(() => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), sampled: vi.fn(),
}));
vi.mock('@/lib/logging/Logger.js', () => {
  const root = { ...log, child: () => log };
  return { default: () => root, getLogger: () => root };
});

const tf = vi.hoisted(() => ({
  setBackend: vi.fn(async () => true),
  ready: vi.fn(async () => {}),
  disposeVariables: vi.fn(),
}));
vi.mock('@tensorflow/tfjs-core', () => tf);
vi.mock('@tensorflow/tfjs-backend-webgl', () => ({}));
vi.mock('@tensorflow/tfjs-backend-cpu', () => ({}));

const wasm = vi.hoisted(() => {
  const state = { requested: -1 };
  return {
    state,
    setWasmPaths: vi.fn(),
    setThreadsCount: vi.fn((n) => { state.requested = n; }),
    // Mirrors tfjs: reports what the pool was built with.
    getThreadsCount: vi.fn(() => (state.requested === -1 ? 1 : state.requested)),
  };
});
vi.mock('@tensorflow/tfjs-backend-wasm', () => wasm);

const pose = vi.hoisted(() => {
  const state = { detectors: [], gates: [], failFor: new Set() };
  const makeDetector = (modelType) => ({
    modelType,
    disposed: false,
    dispose: vi.fn(function dispose() { this.disposed = true; }),
    estimatePoses: vi.fn(async () => []),
  });
  return {
    state,
    SupportedModels: { BlazePose: 'BlazePose' },
    createDetector: vi.fn(async (_model, config) => {
      // A test can park a load until it chooses to release it.
      const gate = state.gates.shift();
      if (gate) await gate;
      if (state.failFor.has(config.modelType)) throw new Error(`cannot load ${config.modelType}`);
      const detector = makeDetector(config.modelType);
      state.detectors.push(detector);
      return detector;
    }),
  };
});
vi.mock('@tensorflow-models/pose-detection', () => pose);

import {
  PoseDetectorService,
  getPoseDetectorService,
  disposePoseDetectorService,
  resolveWasmThreadCount,
} from './PoseDetectorService.js';

// ── Helpers ──────────────────────────────────────────────────────────────────
const live = () => pose.state.detectors.filter((d) => !d.disposed);
const events = (name, level = 'info') => log[level].mock.calls.filter(([event]) => event === name).map(([, data]) => data);
const deferred = () => {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
};
const setEnvironment = ({ crossOriginIsolated, hardwareConcurrency = 16 }) => {
  vi.stubGlobal('crossOriginIsolated', crossOriginIsolated);
  Object.defineProperty(globalThis.navigator, 'hardwareConcurrency', { value: hardwareConcurrency, configurable: true });
};

let getContextSpy;
beforeEach(() => {
  Object.values(log).forEach((fn) => fn.mockClear());
  tf.setBackend.mockClear();
  wasm.setThreadsCount.mockClear();
  wasm.getThreadsCount.mockClear();
  wasm.state.requested = -1;
  pose.createDetector.mockClear();
  pose.state.detectors.length = 0;
  pose.state.gates.length = 0;
  pose.state.failFor.clear();
  // The warm-up draws on a canvas; the test DOM has no 2d context.
  getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue({ fillRect: vi.fn(), fillStyle: '' });
  setEnvironment({ crossOriginIsolated: true });
});

afterEach(() => {
  disposePoseDetectorService();
  getContextSpy.mockRestore();
  vi.unstubAllGlobals();
});

const newService = (options = {}) => new PoseDetectorService({ backend: 'wasm', onError: vi.fn(), ...options });

// ── Thread count ─────────────────────────────────────────────────────────────
describe('resolveWasmThreadCount', () => {
  it('is 1 whenever the page is not cross-origin isolated', () => {
    expect(resolveWasmThreadCount({ crossOriginIsolated: false, hardwareConcurrency: 16 })).toBe(1);
    expect(resolveWasmThreadCount({ requested: 8, crossOriginIsolated: false, hardwareConcurrency: 16 })).toBe(1);
    expect(resolveWasmThreadCount()).toBe(1);
  });

  it('auto is half the cores, capped at 8, never below 1', () => {
    const auto = (cores) => resolveWasmThreadCount({ crossOriginIsolated: true, hardwareConcurrency: cores });
    expect(auto(16)).toBe(8);
    expect(auto(32)).toBe(8);
    expect(auto(8)).toBe(4);
    expect(auto(4)).toBe(2);
    expect(auto(1)).toBe(1);
    expect(auto(undefined)).toBe(1);
  });

  it('honours an explicit count but never exceeds the cores', () => {
    const pinned = (requested, cores) => resolveWasmThreadCount({ requested, crossOriginIsolated: true, hardwareConcurrency: cores });
    expect(pinned(4, 16)).toBe(4);
    expect(pinned(12, 16)).toBe(12);
    expect(pinned(12, 4)).toBe(4);
    expect(pinned(0, 16)).toBe(8);
    expect(pinned('lots', 16)).toBe(8);
  });
});

describe('PoseDetectorService threads', () => {
  it('asks tfjs for threads before the backend starts, and logs what it got, when isolated', async () => {
    const service = newService();
    await service.initialize();

    expect(wasm.setWasmPaths).toHaveBeenCalledWith('/');
    expect(wasm.setThreadsCount).toHaveBeenCalledWith(8);
    expect(wasm.setThreadsCount.mock.invocationCallOrder[0]).toBeLessThan(tf.setBackend.mock.invocationCallOrder[0]);

    const [selected] = events('pose_detector.backend_selected');
    expect(selected).toMatchObject({
      backend: 'wasm', crossOriginIsolated: true, threads: 8, requestedThreads: 8, hardwareConcurrency: 16, modelType: 'full',
    });
    expect(events('pose_detector.wasm_single_threaded', 'warn')).toHaveLength(0);
    expect(service.getState()).toMatchObject({ crossOriginIsolated: true, threads: 8 });
    service.dispose();
  });

  it('leaves the thread count alone, logs 1 thread and warns when not isolated', async () => {
    setEnvironment({ crossOriginIsolated: false });
    const service = newService();
    await service.initialize();

    expect(wasm.setThreadsCount).not.toHaveBeenCalled();
    const [selected] = events('pose_detector.backend_selected');
    expect(selected).toMatchObject({ backend: 'wasm', crossOriginIsolated: false, threads: 1, requestedThreads: 1 });
    expect(events('pose_detector.wasm_single_threaded', 'warn')).toHaveLength(1);
    service.dispose();
  });

  it('honours a configured thread count', async () => {
    const service = newService({ wasmThreads: 4 });
    await service.initialize();
    expect(wasm.setThreadsCount).toHaveBeenCalledWith(4);
    expect(events('pose_detector.backend_selected')[0]).toMatchObject({ threads: 4, requestedThreads: 4 });
    service.dispose();
  });

  it('reports no thread count for a non-wasm backend, and does not warn', async () => {
    setEnvironment({ crossOriginIsolated: false });
    const service = newService({ backend: 'webgl' });
    await service.initialize();
    expect(events('pose_detector.backend_selected')[0]).toMatchObject({ backend: 'webgl', threads: null });
    expect(events('pose_detector.wasm_single_threaded', 'warn')).toHaveLength(0);
    service.dispose();
  });
});

// ── Model switching ──────────────────────────────────────────────────────────
describe('PoseDetectorService model switch', () => {
  it('disposes the old detector and builds a new one for the new model', async () => {
    const service = newService();
    await service.initialize();
    const [full] = pose.state.detectors;
    expect(full.modelType).toBe('full');

    await service.updateConfig({ modelType: 'lite' });

    expect(full.dispose).toHaveBeenCalledTimes(1);
    expect(live()).toHaveLength(1);
    expect(live()[0].modelType).toBe('lite');
    expect(service.detector).toBe(live()[0]);
    expect(service.getState()).toMatchObject({ modelType: 'lite', requestedModelType: 'lite' });
    expect(events('pose_detector.model_switched')).toEqual([
      expect.objectContaining({ from: 'full', to: 'lite', disposedPrevious: true, backend: 'wasm' }),
    ]);
    service.dispose();
  });

  it('runs inference on the new detector after the switch', async () => {
    const service = newService();
    await service.initialize();
    const [full] = pose.state.detectors;
    service.videoSource = { readyState: 4, videoWidth: 0 };
    await service.updateConfig({ modelType: 'lite' });
    const lite = live()[0];
    full.estimatePoses.mockClear();
    lite.estimatePoses.mockClear();

    await service._runInference();

    expect(lite.estimatePoses).toHaveBeenCalledTimes(1);
    expect(full.estimatePoses).not.toHaveBeenCalled();
    service.dispose();
  });

  it('does nothing when the model is unchanged', async () => {
    const service = newService();
    await service.initialize();
    await service.updateConfig({ modelType: 'full', minPoseConfidence: 0.7 });
    expect(pose.createDetector).toHaveBeenCalledTimes(1);
    expect(pose.state.detectors[0].dispose).not.toHaveBeenCalled();
    expect(service.config.minPoseConfidence).toBe(0.7);
    service.dispose();
  });

  it('applies a switch requested while the first model is still loading', async () => {
    // The pre-fix failure: updateConfig() during the load changed config only,
    // and the `full` detector already on its way was what got installed.
    const gate = deferred();
    pose.state.gates.push(gate.promise);
    const service = newService();
    const init = service.initialize();
    await vi.waitFor(() => expect(pose.createDetector).toHaveBeenCalledTimes(1));

    await service.updateConfig({ modelType: 'lite' });
    expect(events('pose_detector.model_switch_deferred')).toEqual([{ to: 'lite', loading: true }]);
    gate.release();
    await init;

    expect(pose.state.detectors.map((d) => d.modelType)).toEqual(['full', 'lite']);
    expect(pose.state.detectors[0].dispose).toHaveBeenCalledTimes(1);
    expect(live().map((d) => d.modelType)).toEqual(['lite']);
    expect(service.getState().modelType).toBe('lite');
    expect(events('pose_detector.model_switched')[0]).toMatchObject({ from: 'full', to: 'lite', reason: 'changed_during_load' });
    service.dispose();
  });

  it('ends on the last model asked for and leaves exactly one detector alive after a burst', async () => {
    const service = newService();
    await service.initialize();
    await Promise.all([
      service.updateConfig({ modelType: 'lite' }),
      service.updateConfig({ modelType: 'heavy' }),
      service.updateConfig({ modelType: 'lite' }),
    ]);
    expect(live()).toHaveLength(1);
    expect(live()[0].modelType).toBe('lite');
    expect(service.detector).toBe(live()[0]);
    service.dispose();
    expect(live()).toHaveLength(0);
  });

  it('lets an inference in flight finish before disposing the detector under it', async () => {
    const service = newService();
    await service.initialize();
    const [full] = pose.state.detectors;
    service.videoSource = { readyState: 4, videoWidth: 0 };
    const inference = deferred();
    full.estimatePoses.mockImplementationOnce(async () => { await inference.promise; return []; });

    const pass = service._runInference();
    const switching = service.updateConfig({ modelType: 'lite' });
    await Promise.resolve();
    await Promise.resolve();
    expect(full.dispose).not.toHaveBeenCalled();

    inference.release();
    await pass;
    await switching;
    expect(full.dispose).toHaveBeenCalledTimes(1);
    expect(live()[0].modelType).toBe('lite');
    service.dispose();
  });

  it('skips inference while the detector is being swapped', async () => {
    const service = newService();
    await service.initialize();
    service.videoSource = { readyState: 4, videoWidth: 0 };
    const gate = deferred();
    pose.state.gates.push(gate.promise);

    const switching = service.updateConfig({ modelType: 'lite' });
    await vi.waitFor(() => expect(pose.createDetector).toHaveBeenCalledTimes(2));
    await service._runInference();
    expect(pose.state.detectors[0].estimatePoses).toHaveBeenCalledTimes(1); // the warm-up only

    gate.release();
    await switching;
    service.dispose();
  });

  it('falls back to the previous model when the new one cannot be built', async () => {
    const onError = vi.fn();
    const service = newService({ onError });
    await service.initialize();
    pose.state.failFor.add('heavy');

    await expect(service.updateConfig({ modelType: 'heavy' })).rejects.toThrow('cannot load heavy');

    expect(live()).toHaveLength(1);
    expect(live()[0].modelType).toBe('full');
    expect(service.getState()).toMatchObject({ modelType: 'full', requestedModelType: 'full' });
    expect(events('pose_detector.model_switch_failed', 'error')).toHaveLength(1);
    expect(events('pose_detector.model_switch_reverted', 'warn')).toEqual([{ to: 'full', attempted: 'heavy' }]);
    expect(onError).toHaveBeenCalledTimes(1);
    service.dispose();
  });

  it('ignores an unknown model type', async () => {
    const service = newService();
    await service.initialize();
    await service.updateConfig({ modelType: 'gigantic' });
    expect(pose.createDetector).toHaveBeenCalledTimes(1);
    expect(service.config.modelType).toBe('full');
    expect(events('pose_detector.unknown_model_type', 'warn')).toHaveLength(1);
    service.dispose();
  });
});

// ── Lifecycle ────────────────────────────────────────────────────────────────
describe('PoseDetectorService lifecycle', () => {
  it('shares one load between concurrent initialize() calls', async () => {
    const service = newService();
    await Promise.all([service.initialize(), service.initialize(), service.initialize()]);
    expect(pose.createDetector).toHaveBeenCalledTimes(1);
    expect(live()).toHaveLength(1);
    service.dispose();
  });

  it('does not install a detector that finishes loading after dispose()', async () => {
    const gate = deferred();
    pose.state.gates.push(gate.promise);
    const service = newService();
    const init = service.initialize();
    await vi.waitFor(() => expect(pose.createDetector).toHaveBeenCalledTimes(1));

    service.dispose();
    gate.release();
    await expect(init).rejects.toThrow(/disposed/);

    expect(service.detector).toBeNull();
    expect(live()).toHaveLength(0);
    expect(service.isInitialized).toBe(false);
  });

  it('disposes the detector when the backend switches', async () => {
    const service = newService();
    await service.initialize();
    await service.updateConfig({ backend: 'webgl' });
    expect(pose.state.detectors[0].dispose).toHaveBeenCalledTimes(1);
    expect(live()).toHaveLength(1);
    expect(service.backend).toBe('webgl');
    expect(events('pose_detector.backend_selected').map((e) => [e.backend, e.reason])).toEqual([['wasm', 'init'], ['webgl', 'switch']]);
    service.dispose();
  });

  it('applies the options of a second consumer to the shared instance', async () => {
    const first = getPoseDetectorService({ backend: 'wasm', onError: vi.fn() });
    await first.initialize();
    const onPoseUpdate = vi.fn();

    const second = getPoseDetectorService({ modelType: 'lite', onPoseUpdate });
    expect(second).toBe(first);
    expect(second.onPoseUpdate).toBe(onPoseUpdate);
    await second._detectorOp;

    expect(live().map((d) => d.modelType)).toEqual(['lite']);
    expect(second.getState().modelType).toBe('lite');
  });
});
