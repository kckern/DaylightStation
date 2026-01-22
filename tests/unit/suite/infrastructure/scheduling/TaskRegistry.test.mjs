// tests/unit/infrastructure/scheduling/TaskRegistry.test.mjs
import { jest } from '@jest/globals';
import { TaskRegistry } from '#backend/src/0_infrastructure/scheduling/TaskRegistry.mjs';

describe('TaskRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = new TaskRegistry();
  });

  describe('register', () => {
    test('registers a task', () => {
      registry.register('myTask', {
        schedule: '0 * * * *',
        handler: () => {}
      });
      expect(registry.get('myTask')).not.toBeNull();
    });

    test('throws without name', () => {
      expect(() => registry.register(null, { handler: () => {} }))
        .toThrow('requires name and handler');
    });

    test('throws without handler', () => {
      expect(() => registry.register('task', {}))
        .toThrow('requires name and handler');
    });

    test('defaults enabled to true', () => {
      registry.register('task', { handler: () => {} });
      expect(registry.get('task').enabled).toBe(true);
    });
  });

  describe('unregister', () => {
    test('removes a task', () => {
      registry.register('task', { handler: () => {} });
      registry.unregister('task');
      expect(registry.get('task')).toBeNull();
    });
  });

  describe('getAll', () => {
    test('returns all tasks', () => {
      registry.register('task1', { handler: () => {} });
      registry.register('task2', { handler: () => {} });
      expect(registry.getAll()).toHaveLength(2);
    });
  });

  describe('execute', () => {
    test('executes task handler', async () => {
      const handler = jest.fn();
      registry.register('task', { handler });
      await registry.execute('task');
      expect(handler).toHaveBeenCalled();
    });

    test('throws for nonexistent task', async () => {
      await expect(registry.execute('nonexistent'))
        .rejects.toThrow('Task not found');
    });

    test('throws for disabled task', async () => {
      registry.register('task', { handler: () => {}, enabled: false });
      await expect(registry.execute('task'))
        .rejects.toThrow('Task disabled');
    });

    test('throws if task already running', async () => {
      let resolve;
      const handler = () => new Promise(r => { resolve = r; });
      registry.register('task', { handler });

      const execution = registry.execute('task');
      await expect(registry.execute('task'))
        .rejects.toThrow('already running');
      resolve();
      await execution;
    });

    test('updates lastRun on success', async () => {
      registry.register('task', { handler: () => {} });
      await registry.execute('task');
      expect(registry.get('task').lastRun).not.toBeNull();
    });

    test('updates lastError on failure', async () => {
      registry.register('task', {
        handler: () => { throw new Error('Test error'); }
      });
      await expect(registry.execute('task')).rejects.toThrow();
      expect(registry.get('task').lastError).toBe('Test error');
    });

    test('increments runCount', async () => {
      registry.register('task', { handler: () => {} });
      await registry.execute('task');
      await registry.execute('task');
      expect(registry.get('task').runCount).toBe(2);
    });
  });

  describe('setEnabled', () => {
    test('enables a task', () => {
      registry.register('task', { handler: () => {}, enabled: false });
      registry.setEnabled('task', true);
      expect(registry.get('task').enabled).toBe(true);
    });

    test('disables a task', () => {
      registry.register('task', { handler: () => {} });
      registry.setEnabled('task', false);
      expect(registry.get('task').enabled).toBe(false);
    });
  });

  describe('isRunning', () => {
    test('returns false when not running', () => {
      registry.register('task', { handler: () => {} });
      expect(registry.isRunning('task')).toBe(false);
    });

    test('returns true when running', async () => {
      let resolve;
      const handler = () => new Promise(r => { resolve = r; });
      registry.register('task', { handler });

      const execution = registry.execute('task');
      expect(registry.isRunning('task')).toBe(true);
      resolve();
      await execution;
      expect(registry.isRunning('task')).toBe(false);
    });
  });

  describe('getStatus', () => {
    test('returns task status', async () => {
      registry.register('task', { schedule: '0 * * * *', handler: () => {} });
      await registry.execute('task');

      const status = registry.getStatus('task');
      expect(status.name).toBe('task');
      expect(status.enabled).toBe(true);
      expect(status.running).toBe(false);
      expect(status.runCount).toBe(1);
    });

    test('returns null for nonexistent task', () => {
      expect(registry.getStatus('nonexistent')).toBeNull();
    });
  });
});
