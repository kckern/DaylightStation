import { describe, it, expect } from 'vitest';
import { CoachingMessageBuilder } from '../../../backend/src/3_applications/coaching/CoachingMessageBuilder.mjs';

describe('CoachingMessageBuilder', () => {
  describe('buildPostReportBlock', () => {
    it('builds status block with percentages', () => {
      const html = CoachingMessageBuilder.buildPostReportBlock({
        calories: { consumed: 850, goal_min: 1200, goal_max: 1600 },
        protein: { consumed: 62, goal: 120 },
      });
      expect(html).toContain('<b>850 / 1600 cal</b>');
      expect(html).toContain('53%');
      expect(html).toContain('<b>62 / 120g protein</b>');
      expect(html).toContain('52%');
    });

    it('handles zero consumed', () => {
      const html = CoachingMessageBuilder.buildPostReportBlock({
        calories: { consumed: 0, goal_min: 1200, goal_max: 1600 },
        protein: { consumed: 0, goal: 120 },
      });
      expect(html).toContain('0%');
      expect(html).toContain('<b>0 / 1600 cal</b>');
    });

    it('shows over-budget when exceeding goal_max', () => {
      const html = CoachingMessageBuilder.buildPostReportBlock({
        calories: { consumed: 2000, goal_min: 1200, goal_max: 1600 },
        protein: { consumed: 150, goal: 120 },
      });
      expect(html).toContain('125%');
    });
  });

  describe('buildMorningBriefBlock', () => {
    it('builds yesterday + 7-day avg + weight', () => {
      const html = CoachingMessageBuilder.buildMorningBriefBlock({
        yesterday: { calories: 1626, protein: 94 },
        weekAvg: { calories: 1450, protein: 112 },
        proteinGoal: 120,
        weight: { current: 170.3, trend7d: -0.09 },
      });
      expect(html).toContain('<b>Yesterday:</b> 1626 cal');
      expect(html).toContain('94g protein');
      expect(html).toContain('<b>7-day avg:</b>');
      expect(html).toContain('target: 120g');
      expect(html).toContain('170.3 lbs');
    });
  });

  describe('buildWeeklyDigestBlock', () => {
    it('builds week vs long-term comparison', () => {
      const html = CoachingMessageBuilder.buildWeeklyDigestBlock({
        thisWeek: { avgCalories: 1453, avgProtein: 112 },
        longTermAvg: { avgCalories: 1520, avgProtein: 105 },
        weight: { weekStart: 170.4, weekEnd: 170.2, trend7d: -0.16 },
      });
      expect(html).toContain('<b>This week:</b>');
      expect(html).toContain('1453 avg cal');
      expect(html).toContain('<b>vs 8-wk avg:</b>');
      expect(html).toContain('<b>Weight trend:</b>');
    });
  });

  describe('buildExerciseReactionBlock', () => {
    it('builds exercise summary with budget impact', () => {
      const html = CoachingMessageBuilder.buildExerciseReactionBlock({
        activity: { type: 'Run', durationMin: 45, caloriesBurned: 320 },
        budgetImpact: 150,
      });
      expect(html).toContain('<b>Run:</b> 45 min');
      expect(html).toContain('320 cal burned');
      expect(html).toContain('~150 extra cal earned');
    });
  });

  describe('wrapCommentary', () => {
    it('wraps non-empty commentary in blockquote', () => {
      const html = CoachingMessageBuilder.wrapCommentary('That chicken hit hard.');
      expect(html).toBe('\n\n<blockquote>That chicken hit hard.</blockquote>');
    });

    it('returns empty string for empty commentary', () => {
      expect(CoachingMessageBuilder.wrapCommentary('')).toBe('');
      expect(CoachingMessageBuilder.wrapCommentary(null)).toBe('');
    });
  });
});
