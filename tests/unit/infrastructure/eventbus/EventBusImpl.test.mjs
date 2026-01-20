// tests/unit/infrastructure/eventbus/EventBusImpl.test.mjs
import { jest } from '@jest/globals';
import { EventBusImpl } from '../../../../backend/src/0_infrastructure/eventbus/EventBusImpl.mjs';

describe('EventBusImpl', () => {
  let bus;

  beforeEach(() => {
    bus = new EventBusImpl();
  });

  describe('subscribe', () => {
    test('adds subscriber for topic', () => {
      bus.subscribe('topic1', () => {});
      expect(bus.getSubscriberCount('topic1')).toBe(1);
    });

    test('supports multiple subscribers per topic', () => {
      bus.subscribe('topic1', () => {});
      bus.subscribe('topic1', () => {});
      expect(bus.getSubscriberCount('topic1')).toBe(2);
    });

    test('returns unsubscribe function', () => {
      const unsubscribe = bus.subscribe('topic1', () => {});
      expect(typeof unsubscribe).toBe('function');
      unsubscribe();
      expect(bus.getSubscriberCount('topic1')).toBe(0);
    });
  });

  describe('unsubscribe', () => {
    test('removes subscriber', () => {
      const handler = () => {};
      bus.subscribe('topic1', handler);
      bus.unsubscribe('topic1', handler);
      expect(bus.getSubscriberCount('topic1')).toBe(0);
    });

    test('only removes specific handler', () => {
      const handler1 = () => {};
      const handler2 = () => {};
      bus.subscribe('topic1', handler1);
      bus.subscribe('topic1', handler2);
      bus.unsubscribe('topic1', handler1);
      expect(bus.getSubscriberCount('topic1')).toBe(1);
    });
  });

  describe('publish', () => {
    test('calls subscriber with payload', () => {
      const handler = jest.fn();
      bus.subscribe('topic1', handler);
      bus.publish('topic1', { data: 'test' });
      expect(handler).toHaveBeenCalledWith({ data: 'test' }, 'topic1');
    });

    test('calls all subscribers for topic', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      bus.subscribe('topic1', handler1);
      bus.subscribe('topic1', handler2);
      bus.publish('topic1', 'data');
      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    test('does not call subscribers for other topics', () => {
      const handler = jest.fn();
      bus.subscribe('topic1', handler);
      bus.publish('topic2', 'data');
      expect(handler).not.toHaveBeenCalled();
    });

    test('continues if handler throws', () => {
      const handler1 = jest.fn(() => { throw new Error('fail'); });
      const handler2 = jest.fn();
      bus.subscribe('topic1', handler1);
      bus.subscribe('topic1', handler2);
      bus.publish('topic1', 'data');
      expect(handler2).toHaveBeenCalled();
    });
  });

  describe('addAdapter', () => {
    test('broadcasts to adapters on publish', () => {
      const adapter = { broadcast: jest.fn() };
      bus.addAdapter(adapter);
      bus.publish('topic1', { data: 'test' });
      expect(adapter.broadcast).toHaveBeenCalledWith('topic1', { data: 'test' });
    });

    test('broadcasts to multiple adapters', () => {
      const adapter1 = { broadcast: jest.fn() };
      const adapter2 = { broadcast: jest.fn() };
      bus.addAdapter(adapter1);
      bus.addAdapter(adapter2);
      bus.publish('topic1', 'data');
      expect(adapter1.broadcast).toHaveBeenCalled();
      expect(adapter2.broadcast).toHaveBeenCalled();
    });

    test('continues if adapter throws', () => {
      const adapter1 = { broadcast: () => { throw new Error('fail'); } };
      const adapter2 = { broadcast: jest.fn() };
      bus.addAdapter(adapter1);
      bus.addAdapter(adapter2);
      bus.publish('topic1', 'data');
      expect(adapter2.broadcast).toHaveBeenCalled();
    });
  });

  describe('getTopics', () => {
    test('returns topics with subscribers', () => {
      bus.subscribe('topic1', () => {});
      bus.subscribe('topic2', () => {});
      expect(bus.getTopics()).toContain('topic1');
      expect(bus.getTopics()).toContain('topic2');
    });

    test('returns empty array when no subscribers', () => {
      expect(bus.getTopics()).toEqual([]);
    });
  });
});
