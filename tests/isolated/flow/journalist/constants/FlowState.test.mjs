import { describe, it, expect } from '@jest/globals';
import {
  FlowType,
  SubFlowType,
  isValidFlow,
  isValidSubFlow,
  getValidSubFlows
} from '#backend/src/3_applications/journalist/constants/FlowState.mjs';

describe('FlowState Constants', () => {
  describe('FlowType', () => {
    it('should define all flow types', () => {
      expect(FlowType.FREE_WRITE).toBe('free_write');
      expect(FlowType.MORNING_DEBRIEF).toBe('morning_debrief');
      expect(FlowType.QUIZ).toBe('quiz');
      expect(FlowType.INTERVIEW).toBe('interview');
    });
  });

  describe('SubFlowType', () => {
    it('should define all sub-flow types', () => {
      expect(SubFlowType.SOURCE_PICKER).toBe('source_picker');
      expect(SubFlowType.INTERVIEW).toBe('interview');
      expect(SubFlowType.CATEGORY_PICKER).toBe('category_picker');
    });
  });

  describe('isValidFlow', () => {
    it('should return true for valid flow types', () => {
      expect(isValidFlow('free_write')).toBe(true);
      expect(isValidFlow('morning_debrief')).toBe(true);
    });

    it('should return false for invalid flow types', () => {
      expect(isValidFlow('invalid')).toBe(false);
      expect(isValidFlow(null)).toBe(false);
    });
  });

  describe('isValidSubFlow', () => {
    it('should return true for valid sub-flow for morning_debrief', () => {
      expect(isValidSubFlow('morning_debrief', 'source_picker')).toBe(true);
      expect(isValidSubFlow('morning_debrief', 'interview')).toBe(true);
      expect(isValidSubFlow('morning_debrief', null)).toBe(true);
    });

    it('should return false for invalid sub-flow', () => {
      expect(isValidSubFlow('morning_debrief', 'invalid')).toBe(false);
      expect(isValidSubFlow('free_write', 'source_picker')).toBe(false);
    });
  });

  describe('getValidSubFlows', () => {
    it('should return valid sub-flows for morning_debrief', () => {
      const subFlows = getValidSubFlows('morning_debrief');
      expect(subFlows).toContain('source_picker');
      expect(subFlows).toContain('interview');
      expect(subFlows).toContain(null);
    });

    it('should return empty array for flows without sub-flows', () => {
      const subFlows = getValidSubFlows('free_write');
      expect(subFlows).toEqual([null]);
    });
  });
});
