import { describe, it, expect, beforeEach } from '@jest/globals';
import { LayoutManager } from '../../../frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/layout/LayoutManager.js';
import { CHART_DEFAULTS, createPRNG, generateAvatars, generateClusteredAvatars, detectAnomalies } from './testUtils.mjs';

const MARGIN = CHART_DEFAULTS.margin;

describe('LayoutManager', () => {
  let manager;

  beforeEach(() => {
    manager = new LayoutManager({
      bounds: { width: 420, height: 390, margin: MARGIN },
      avatarRadius: 30,
      badgeRadius: 10,
      trace: true
    });
  });

  describe('single avatar', () => {
    it('should not displace a single avatar', () => {
      const input = [{
        type: 'avatar',
        id: 'user-0',
        x: 300,
        y: 150,
        name: 'Test User',
        color: '#4ade80',
        value: 1000
      }];

      const { elements, trace } = manager.layout(input);
      const avatar = elements.find(e => e.id === 'user-0');

      expect(avatar.offsetX || 0).toBe(0);
      expect(avatar.offsetY || 0).toBe(0);
    });

    it('should clamp avatar at right edge', () => {
      const input = [{
        type: 'avatar',
        id: 'user-0',
        x: 450,
        y: 150,
        name: 'Test User',
        color: '#4ade80',
        value: 1000
      }];

      const { elements } = manager.layout(input);
      const avatar = elements.find(e => e.id === 'user-0');
      const finalX = avatar.x + (avatar.offsetX || 0);

      expect(finalX).toBeLessThanOrEqual(420 - MARGIN.right);
    });
  });

  describe('two avatars', () => {
    it('should not displace non-overlapping avatars', () => {
      const input = [
        { type: 'avatar', id: 'user-0', x: 100, y: 100, name: 'A', color: '#4ade80', value: 1000 },
        { type: 'avatar', id: 'user-1', x: 300, y: 250, name: 'B', color: '#4ade80', value: 2000 }
      ];

      const { elements } = manager.layout(input);

      const a = elements.find(e => e.id === 'user-0');
      const b = elements.find(e => e.id === 'user-1');

      expect(Math.abs(a.offsetX || 0)).toBeLessThan(1);
      expect(Math.abs(b.offsetX || 0)).toBeLessThan(1);
    });

    it('should displace overlapping avatars horizontally', () => {
      const input = [
        { type: 'avatar', id: 'user-0', x: 300, y: 150, name: 'A', color: '#4ade80', value: 1000 },
        { type: 'avatar', id: 'user-1', x: 305, y: 155, name: 'B', color: '#4ade80', value: 2000 }
      ];

      const { elements, trace } = manager.layout(input);

      const displaced = elements.find(e => e.id === 'user-1');
      expect(displaced.offsetX || 0).toBeLessThan(0);

      const collisionTraces = trace.filter(t => t.phase === 'collision_resolve');
      expect(collisionTraces.length).toBeGreaterThan(0);
    });
  });

  describe('three+ avatars clustered', () => {
    it('should resolve without excessive displacement', () => {
      const prng = createPRNG(12345);
      const input = generateClusteredAvatars(prng, 4, { tickCount: 3 });

      const { elements, trace } = manager.layout(input);
      const { anomalies } = detectAnomalies(input, elements, trace);

      const excessiveAnomalies = anomalies.filter(a => a.type === 'excessive_displacement');
      expect(excessiveAnomalies).toEqual([]);
    });

    it('should keep all avatars within bounds', () => {
      const prng = createPRNG(54321);
      const input = generateClusteredAvatars(prng, 5, { tickCount: 2 });

      const { elements } = manager.layout(input);
      const { anomalies } = detectAnomalies(input, elements, []);

      const outOfBounds = anomalies.filter(a => a.type === 'out_of_bounds');
      expect(outOfBounds).toEqual([]);
    });
  });

  describe('early frame scenarios (low tick count)', () => {
    it('should handle tick count of 1', () => {
      const input = [
        { type: 'avatar', id: 'user-0', x: MARGIN.left, y: 100, name: 'A', color: '#4ade80', value: 1000 },
        { type: 'avatar', id: 'user-1', x: MARGIN.left, y: 110, name: 'B', color: '#4ade80', value: 1500 },
        { type: 'avatar', id: 'user-2', x: MARGIN.left, y: 120, name: 'C', color: '#4ade80', value: 2000 }
      ];

      const { elements, trace } = manager.layout(input);
      const { anomalies } = detectAnomalies(input, elements, trace);

      const excessive = anomalies.filter(a => a.type === 'excessive_displacement');
      expect(excessive).toEqual([]);
    });

    it('should handle tick count of 2 with avatars at ticks 0 and 1', () => {
      const width = 420;
      const innerWidth = width - MARGIN.left - MARGIN.right;

      const input = [
        { type: 'avatar', id: 'user-0', x: MARGIN.left, y: 150, name: 'A', color: '#4ade80', value: 1000 },
        { type: 'avatar', id: 'user-1', x: MARGIN.left + innerWidth, y: 155, name: 'B', color: '#4ade80', value: 1500 }
      ];

      const { elements } = manager.layout(input);

      const a = elements.find(e => e.id === 'user-0');
      const b = elements.find(e => e.id === 'user-1');

      expect(Math.abs(a.offsetX || 0)).toBeLessThan(5);
      expect(Math.abs(b.offsetX || 0)).toBeLessThan(5);
    });
  });

  describe('boundary conditions', () => {
    it('should clamp avatar near right edge and set label position', () => {
      const input = [{
        type: 'avatar',
        id: 'user-0',
        x: 400,
        y: 150,
        name: 'Test',
        color: '#4ade80',
        value: 1000
      }];

      const { elements } = manager.layout(input);
      const avatar = elements.find(e => e.id === 'user-0');
      const finalX = avatar.x + (avatar.offsetX || 0);

      // Avatar should be clamped to max X (420 - 90 = 330)
      expect(finalX).toBeLessThanOrEqual(420 - MARGIN.right);
      // LabelManager resolves label position (defaults to 'right' when no collision)
      expect(avatar.labelPosition).toBeDefined();
    });

    it('should handle avatar exactly at left margin', () => {
      const input = [{
        type: 'avatar',
        id: 'user-0',
        x: MARGIN.left,
        y: 150,
        name: 'Test',
        color: '#4ade80',
        value: 1000
      }];

      const { elements } = manager.layout(input);
      const avatar = elements.find(e => e.id === 'user-0');
      const finalX = avatar.x + (avatar.offsetX || 0);

      expect(finalX).toBeGreaterThanOrEqual(MARGIN.left);
    });
  });

  describe('trace functionality', () => {
    it('should record input phase for all elements', () => {
      const input = [
        { type: 'avatar', id: 'user-0', x: 300, y: 150, name: 'A', color: '#4ade80', value: 1000 },
        { type: 'badge', id: 'badge-0', x: 200, y: 200, initial: 'X', name: 'Dropout' }
      ];

      const { trace } = manager.layout(input);
      const inputTraces = trace.filter(t => t.phase === 'input');

      expect(inputTraces.length).toBe(2);
      expect(inputTraces.some(t => t.elementId === 'user-0')).toBe(true);
      expect(inputTraces.some(t => t.elementId === 'badge-0')).toBe(true);
    });

    it('should not generate trace when disabled', () => {
      const noTraceManager = new LayoutManager({
        bounds: { width: 420, height: 390, margin: MARGIN },
        trace: false
      });

      const input = [{ type: 'avatar', id: 'user-0', x: 300, y: 150, name: 'A', color: '#4ade80', value: 1000 }];
      const { trace } = noTraceManager.layout(input);

      expect(trace).toBeUndefined();
    });
  });
});
