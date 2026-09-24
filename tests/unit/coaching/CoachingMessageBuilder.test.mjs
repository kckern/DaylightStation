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
    const base = {
      weekAvg: { calories: 1450, protein: 112, trustedDays: 7, totalDays: 7 },
      proteinGoal: 120,
      weight: { current: 170.33, trend7d: -0.09 },
      minCalories: 1200,
    };

    it('builds yesterday + 7-day avg + weight for a complete day', () => {
      const html = CoachingMessageBuilder.buildMorningBriefBlock({
        ...base, yesterday: { calories: 1626, protein: 94, status: 'complete' },
      });
      expect(html).toContain('<b>Yesterday:</b> 1626 cal');
      expect(html).toContain('94g protein');
      expect(html).toContain('<b>7-day avg:</b>');
      expect(html).toContain('target: 120g');
      expect(html).toContain('170.3 lbs (-0.09/wk)');
      expect(html).not.toContain('fully logged');
      expect(html).not.toContain('incomplete');
    });

    it('flags an incomplete yesterday instead of reporting it as intake', () => {
      const html = CoachingMessageBuilder.buildMorningBriefBlock({
        ...base, yesterday: { calories: 460, protein: 18, status: 'incomplete' },
      });
      expect(html).toContain('460 cal · 18g protein logged — looks incomplete');
      expect(html).toContain('Under 1200 cal');
      expect(html).toContain('/done yesterday');
    });

    it('says nothing logged for an unlogged yesterday', () => {
      const html = CoachingMessageBuilder.buildMorningBriefBlock({
        ...base, yesterday: { calories: 0, protein: 0, status: 'unlogged' },
      });
      expect(html).toContain('<b>Yesterday:</b> nothing logged');
    });

    it('labels a confirmed fast', () => {
      const html = CoachingMessageBuilder.buildMorningBriefBlock({
        ...base, yesterday: { calories: 0, protein: 0, status: 'fasting' },
      });
      expect(html).toContain('<b>Yesterday:</b> fast');
    });

    it('shows coverage when some days are untrusted, and no average when none are', () => {
      const partial = CoachingMessageBuilder.buildMorningBriefBlock({
        ...base, yesterday: { calories: 1500, protein: 90, status: 'complete' },
        weekAvg: { calories: 1500, protein: 90, trustedDays: 3, totalDays: 7 },
      });
      expect(partial).toContain('3 of 7 days fully logged');

      const none = CoachingMessageBuilder.buildMorningBriefBlock({
        ...base, yesterday: { calories: 400, protein: 20, status: 'incomplete' },
        weekAvg: { calories: null, protein: null, trustedDays: 0, totalDays: 7 },
      });
      expect(none).toContain('<b>7-day avg:</b> no fully logged days');
    });

    it('omits the weight line when there is no weight data', () => {
      const html = CoachingMessageBuilder.buildMorningBriefBlock({
        ...base, weight: null, yesterday: { calories: 1500, protein: 90, status: 'complete' },
      });
      expect(html).not.toContain('Weight');
      expect(html).not.toContain('0 lbs');
    });
  });

  describe('buildWeeklyDigestBlock', () => {
    it('builds week vs long-term comparison', () => {
      const html = CoachingMessageBuilder.buildWeeklyDigestBlock({
        thisWeek: { calories: 1453, protein: 112, trustedDays: 5, totalDays: 7 },
        longTermAvg: { calories: 1520, protein: 105, trustedDays: 40, totalDays: 56 },
        weight: { weekStart: 170.4, weekEnd: 170.2, trend7d: -0.16 },
      });
      expect(html).toContain('<b>This week:</b>');
      expect(html).toContain('1453 avg cal');
      expect(html).toContain('5 of 7 days fully logged');
      expect(html).toContain('<b>vs 8-wk avg:</b>');
      expect(html).toContain('<b>Weight trend:</b> -0.16 lbs this week · 170.4 → 170.2');
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
