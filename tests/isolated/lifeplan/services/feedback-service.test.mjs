import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { FeedbackService } from '#apps/lifeplan/services/FeedbackService.mjs';
import { RetroService } from '#apps/lifeplan/services/RetroService.mjs';

describe('FeedbackService', () => {
  let service;
  let mockLifePlanStore;

  const mockPlan = {
    feedback: [],
    goals: [{ id: 'g1', name: 'Run marathon', state: 'committed' }],
    beliefs: [{ id: 'b1', state: 'testing' }],
    values: [{ id: 'v1', name: 'Health' }],
    qualities: [{ id: 'q1', name: 'Discipline' }],
    toJSON() { return this; },
  };

  beforeEach(() => {
    mockPlan.feedback = [];
    mockLifePlanStore = {
      load: jest.fn().mockReturnValue(mockPlan),
      save: jest.fn(),
    };

    service = new FeedbackService({ lifePlanStore: mockLifePlanStore });
  });

  it('records an observation linked to a goal', () => {
    service.recordObservation('testuser', {
      text: 'Struggled with long run today',
      element_type: 'goal',
      element_id: 'g1',
      sentiment: 'friction',
    });

    expect(mockLifePlanStore.save).toHaveBeenCalled();
    const savedPlan = mockLifePlanStore.save.mock.calls[0][1];
    expect(savedPlan.feedback).toHaveLength(1);
    expect(savedPlan.feedback[0].element_type).toBe('goal');
    expect(savedPlan.feedback[0].element_id).toBe('g1');
  });

  it('records an observation without element link', () => {
    service.recordObservation('testuser', {
      text: 'Feeling good about life direction',
      sentiment: 'positive',
    });

    const saved = mockLifePlanStore.save.mock.calls[0][1];
    expect(saved.feedback).toHaveLength(1);
    expect(saved.feedback[0].element_type).toBeUndefined();
  });

  it('getFeedback returns entries for a period', () => {
    mockPlan.feedback = [
      { text: 'old', timestamp: '2025-05-01T00:00:00Z' },
      { text: 'recent', timestamp: '2025-06-10T00:00:00Z' },
      { text: 'newer', timestamp: '2025-06-15T00:00:00Z' },
    ];

    const result = service.getFeedback('testuser', {
      start: '2025-06-01',
      end: '2025-06-30',
    });

    expect(result).toHaveLength(2);
  });

  it('getFeedback returns all when no period specified', () => {
    mockPlan.feedback = [
      { text: 'a', timestamp: '2025-05-01T00:00:00Z' },
      { text: 'b', timestamp: '2025-06-15T00:00:00Z' },
    ];

    const result = service.getFeedback('testuser');
    expect(result).toHaveLength(2);
  });
});

describe('RetroService', () => {
  let service;
  let mockLifePlanStore;
  let mockFeedbackService;
  let mockDriftService;

  const mockPlan = {
    goals: [
      { id: 'g1', name: 'Run marathon', state: 'committed', progress: 0.6 },
      { id: 'g2', name: 'Learn piano', state: 'achieved', progress: 1.0 },
    ],
    beliefs: [
      { id: 'b1', confidence: 0.8, state: 'confirmed', evidence_history: [{ type: 'confirmation' }] },
    ],
    values: [{ id: 'v1', name: 'Health', alignment_state: 'aligned' }],
    qualities: [{ id: 'q1', name: 'Discipline', rules: [{ effectiveness: 'effective' }] }],
    toJSON() { return this; },
  };

  beforeEach(() => {
    mockLifePlanStore = {
      load: jest.fn().mockReturnValue(mockPlan),
    };
    mockFeedbackService = {
      getFeedback: jest.fn().mockReturnValue([
        { text: 'Good week', sentiment: 'positive' },
        { text: 'Struggling', sentiment: 'friction' },
      ]),
    };
    mockDriftService = {
      getLatestSnapshot: jest.fn().mockReturnValue({ correlation: 0.75, status: 'drifting' }),
    };

    service = new RetroService({
      lifePlanStore: mockLifePlanStore,
      feedbackService: mockFeedbackService,
      driftService: mockDriftService,
    });
  });

  it('generates retrospective content', () => {
    const retro = service.generateRetro('testuser', { start: '2025-06-01', end: '2025-06-15' });

    expect(retro.feedback).toHaveLength(2);
    expect(retro.goalSummary).toBeDefined();
    expect(retro.goalSummary.active).toBe(1);
    expect(retro.goalSummary.achieved).toBe(1);
    expect(retro.drift).toBeDefined();
    expect(retro.drift.correlation).toBe(0.75);
    expect(retro.beliefSummary).toBeDefined();
    expect(retro.ruleEffectiveness).toBeDefined();
  });

  it('handles missing drift data gracefully', () => {
    mockDriftService.getLatestSnapshot.mockReturnValue(null);

    const retro = service.generateRetro('testuser', { start: '2025-06-01', end: '2025-06-15' });
    expect(retro.drift).toBeNull();
  });
});
