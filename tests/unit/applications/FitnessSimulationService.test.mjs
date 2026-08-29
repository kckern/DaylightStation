import { describe, expect, it, vi } from 'vitest';
import { FitnessSimulationService } from '#adapters/fitness/FitnessSimulationProcess.mjs';

describe('FitnessSimulationService', () => {
  it('preserves simulation arguments and lifecycle responses through injected process operations', () => {
    let onExit;
    const processHandle = { pid: 4242, killed: false, unref: vi.fn(), on: vi.fn((event, handler) => { if (event === 'exit') onExit = handler; }) };
    const runDetached = vi.fn(() => processHandle);
    const terminateProcess = vi.fn();
    const service = new FitnessSimulationService({
      runDetached,
      terminateProcess,
      scriptPath: '/workspace/_extensions/fitness/simulation.mjs',
      logger: { info() {} },
    });

    expect(service.start({ duration: 30, users: 2, rpm: 40 })).toEqual({
      started: true, pid: 4242, config: { duration: 30, users: 2, rpm: 40 },
    });
    expect(runDetached).toHaveBeenCalledWith('node', ['/workspace/_extensions/fitness/simulation.mjs', '--duration=30', '2', '2', '40']);
    expect(service.stop()).toEqual({ stopped: true, pid: 4242 });
    expect(terminateProcess).toHaveBeenCalledWith(4242, 'SIGTERM');
    onExit();
    expect(service.status().running).toBe(false);
  });
});
