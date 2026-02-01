// tests/isolated/flow/canvas/CanvasService.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { CanvasService } from '../../../../backend/src/3_applications/canvas/services/CanvasService.mjs';

describe('CanvasService', () => {
  let service;
  let mockContentSource;
  let mockSelectionService;
  let mockScheduler;
  let mockEventSource;
  let mockContextProvider;
  let mockHistoryStore;

  beforeEach(() => {
    mockContentSource = {
      source: 'test',
      list: jest.fn().mockResolvedValue([
        { id: '1', category: 'landscapes', tags: ['morning'] },
        { id: '2', category: 'abstract', tags: ['evening'] },
      ]),
    };

    mockSelectionService = {
      selectForContext: jest.fn().mockImplementation((items) => items),
      pickNext: jest.fn().mockImplementation((pool) => pool[0]),
      buildContextFilters: jest.fn().mockReturnValue({ tags: [], categories: [] }),
    };

    mockScheduler = {
      scheduleRotation: jest.fn(),
      resetTimer: jest.fn(),
      cancelRotation: jest.fn(),
    };

    mockEventSource = {
      onMotionDetected: jest.fn(),
      onContextTrigger: jest.fn(),
      onManualAdvance: jest.fn(),
    };

    mockContextProvider = {
      getContext: jest.fn().mockResolvedValue({
        timeSlot: 'morning',
        calendarTags: [],
        deviceConfig: {},
        options: { mode: 'random', interval: 300 },
      }),
      getTimeSlot: jest.fn().mockReturnValue('morning'),
    };

    mockHistoryStore = {
      getShownHistory: jest.fn().mockResolvedValue([]),
      recordShown: jest.fn().mockResolvedValue(undefined),
    };

    service = new CanvasService({
      contentSources: [mockContentSource],
      selectionService: mockSelectionService,
      scheduler: mockScheduler,
      eventSource: mockEventSource,
      contextProvider: mockContextProvider,
      historyStore: mockHistoryStore,
    });
  });

  describe('getCurrent', () => {
    it('fetches items from content sources', async () => {
      await service.getCurrent('device-1', 'household-1');
      expect(mockContentSource.list).toHaveBeenCalled();
    });

    it('applies context filtering', async () => {
      await service.getCurrent('device-1', 'household-1');
      expect(mockContextProvider.getContext).toHaveBeenCalledWith('device-1', 'household-1');
      expect(mockSelectionService.selectForContext).toHaveBeenCalled();
    });

    it('picks next item avoiding history', async () => {
      mockHistoryStore.getShownHistory.mockResolvedValue(['1']);
      await service.getCurrent('device-1', 'household-1');
      expect(mockSelectionService.pickNext).toHaveBeenCalledWith(
        expect.any(Array),
        ['1'],
        expect.any(Object)
      );
    });

    it('records shown item in history', async () => {
      await service.getCurrent('device-1', 'household-1');
      expect(mockHistoryStore.recordShown).toHaveBeenCalledWith('device-1', '1');
    });
  });

  describe('event wiring', () => {
    it('registers motion callback that resets timer', () => {
      expect(mockEventSource.onMotionDetected).toHaveBeenCalled();
      const callback = mockEventSource.onMotionDetected.mock.calls[0][0];
      callback('device-1');
      expect(mockScheduler.resetTimer).toHaveBeenCalledWith('device-1');
    });

    it('registers manual advance callback', () => {
      expect(mockEventSource.onManualAdvance).toHaveBeenCalled();
    });
  });

  describe('startRotation', () => {
    it('schedules rotation for device', async () => {
      await service.startRotation('device-1', 'household-1');
      expect(mockScheduler.scheduleRotation).toHaveBeenCalledWith(
        'device-1',
        300000, // 300 seconds in ms
        expect.any(Function)
      );
    });
  });
});
