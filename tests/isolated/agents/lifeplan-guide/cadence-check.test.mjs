import { describe, it, expect, beforeEach } from '@jest/globals';
import { CadenceCheck } from '#apps/agents/lifeplan-guide/assignments/CadenceCheck.mjs';

describe('CadenceCheck', () => {
  it('has correct static properties', () => {
    expect(CadenceCheck.id).toBe('cadence-check');
    expect(CadenceCheck.schedule).toBeDefined();
  });

  describe('gather', () => {
    it('collects ceremony status and drift data', async () => {
      const check = new CadenceCheck();
      const mockTools = [
        { name: 'check_ceremony_status', execute: async () => ({
          ceremonies: [
            { type: 'cycle_retro', isDue: true, isCompleted: false, isOverdue: true },
            { type: 'unit_intention', isDue: true, isCompleted: true, isOverdue: false },
          ],
        })},
        { name: 'get_value_allocation', execute: async () => ({
          correlation: 0.4, status: 'drifting',
        })},
        { name: 'get_plan', execute: async () => ({
          goals: [{ id: 'g1', name: 'Run marathon', state: 'active' }],
        })},
      ];

      const result = await check.gather({ tools: mockTools, userId: 'test', memory: { get: () => null }, logger: console });
      expect(result.ceremonyStatus).toBeDefined();
      expect(result.ceremonyStatus.ceremonies).toHaveLength(2);
    });

    it('returns nothing_actionable when all ceremonies complete and no drift', async () => {
      const check = new CadenceCheck();
      const mockTools = [
        { name: 'check_ceremony_status', execute: async () => ({
          ceremonies: [
            { type: 'unit_intention', isDue: true, isCompleted: true, isOverdue: false },
          ],
        })},
        { name: 'get_value_allocation', execute: async () => ({
          correlation: 0.9, status: 'aligned',
        })},
        { name: 'get_plan', execute: async () => ({
          goals: [],
        })},
      ];

      const result = await check.gather({ tools: mockTools, userId: 'test', memory: { get: () => null }, logger: console });
      expect(result.nothing_actionable).toBe(true);
    });
  });
});
