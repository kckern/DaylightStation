import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventAggregationService } from '#apps/home/EventAggregationService.mjs';

describe('EventAggregationService', () => {
  let service;
  let mockDataService;
  let mockConfigService;
  let mockLogger;

  beforeEach(() => {
    mockDataService = {
      user: {
        read: vi.fn().mockReturnValue(null),
      },
    };
    mockConfigService = {
      getHeadOfHousehold: vi.fn().mockReturnValue('kckern'),
    };
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    service = new EventAggregationService({
      dataService: mockDataService,
      configService: mockConfigService,
      logger: mockLogger,
    });
  });

  it('returns empty array when no data exists', () => {
    const events = service.getUpcomingEvents();
    expect(events).toEqual([]);
  });

  it('maps a timed calendar event to unified schema', () => {
    mockDataService.user.read.mockImplementation((path) => {
      if (path === 'current/calendar') {
        return [
          {
            id: 'cal-1',
            date: '2026-03-10',
            time: '14:00',
            endTime: '15:00',
            summary: 'Dentist Appointment',
            description: 'Annual checkup',
            location: '123 Main St',
            allday: false,
            duration: 60,
            startDateTime: '2026-03-10T14:00:00',
            startDate: '2026-03-10',
            calendarName: 'Personal',
          },
        ];
      }
      return null;
    });

    const events = service.getUpcomingEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      id: 'cal-1',
      start: '2026-03-10T14:00:00',
      end: '15:00',
      summary: 'Dentist Appointment',
      description: 'Annual checkup',
      type: 'calendar',
      domain: 'Personal',
      location: '123 Main St',
      url: null,
      allday: false,
      status: null,
    });
  });

  it('maps an allday calendar event correctly', () => {
    mockDataService.user.read.mockImplementation((path) => {
      if (path === 'current/calendar') {
        return [
          {
            id: 'cal-2',
            date: '2026-03-06',
            time: null,
            endTime: null,
            summary: 'Kern Parents Visit?',
            description: null,
            location: null,
            allday: true,
            duration: null,
            startDateTime: '2026-03-06',
            startDate: '2026-03-06',
          },
        ];
      }
      return null;
    });

    const events = service.getUpcomingEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      id: 'cal-2',
      start: '2026-03-06',
      end: null,
      summary: 'Kern Parents Visit?',
      description: null,
      type: 'calendar',
      domain: null,
      location: null,
      url: null,
      allday: true,
      status: null,
    });
  });

  it('maps todoist tasks with dueDate to unified schema', () => {
    mockDataService.user.read.mockImplementation((path) => {
      if (path === 'current/todoist') {
        return {
          taskCount: 1,
          tasks: [
            {
              id: '6frX7VPFJfVrRvhx',
              content: 'Get groceries',
              description: 'From Costco',
              dueDate: '2026-03-11',
              dueString: 'tomorrow',
              labels: [],
              priority: 1,
              projectId: '6CrcrFRh9Pg4m3fQ',
              url: 'https://app.todoist.com/app/task/6frX7VPFJfVrRvhx',
            },
          ],
        };
      }
      return null;
    });

    const events = service.getUpcomingEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      id: '6frX7VPFJfVrRvhx',
      start: '2026-03-11',
      end: null,
      summary: 'Get groceries',
      description: 'From Costco',
      type: 'todoist',
      domain: 'app.todoist.com',
      location: null,
      url: 'https://app.todoist.com/app/task/6frX7VPFJfVrRvhx',
      allday: true,
      status: null,
    });
  });

  it('maps todoist tasks without due dates (start: null)', () => {
    mockDataService.user.read.mockImplementation((path) => {
      if (path === 'current/todoist') {
        return {
          taskCount: 1,
          tasks: [
            {
              id: 'abc123',
              content: 'Someday task',
              description: '',
              dueDate: null,
              dueString: null,
              labels: [],
              priority: 1,
              projectId: 'proj1',
            },
          ],
        };
      }
      return null;
    });

    const events = service.getUpcomingEvents();
    expect(events).toHaveLength(1);
    expect(events[0].start).toBeNull();
    expect(events[0].summary).toBe('Someday task');
    expect(events[0].url).toBe('https://app.todoist.com/app/task/abc123');
  });

  it('maps clickup tasks to unified schema', () => {
    mockDataService.user.read.mockImplementation((path) => {
      if (path === 'current/clickup') {
        return {
          taskCount: 1,
          tasks: [
            {
              id: '86d1dwkv8',
              name: 'Entry Report Panel',
              status: 'in progress',
              date_created: '1767165871221',
              taxonomy: {
                '5887321': 'Personal Projects',
                '12120791': 'Daylight Station',
              },
            },
          ],
        };
      }
      return null;
    });

    const events = service.getUpcomingEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      id: '86d1dwkv8',
      start: null,
      end: null,
      summary: 'Entry Report Panel',
      description: null,
      type: 'clickup',
      domain: 'app.clickup.com',
      location: null,
      url: `https://app.clickup.com/t/86d1dwkv8`,
      allday: false,
      status: 'in progress',
    });
  });

  it('merges all three sources and sorts by start date (nulls last)', () => {
    mockDataService.user.read.mockImplementation((path) => {
      if (path === 'current/calendar') {
        return [
          {
            id: 'cal-later',
            date: '2026-03-15',
            time: null,
            endTime: null,
            summary: 'Later Event',
            description: null,
            location: null,
            allday: true,
            startDateTime: '2026-03-15',
            startDate: '2026-03-15',
          },
          {
            id: 'cal-early',
            date: '2026-03-10',
            time: '09:00',
            endTime: '10:00',
            summary: 'Early Event',
            description: null,
            location: null,
            allday: false,
            startDateTime: '2026-03-10T09:00:00',
            startDate: '2026-03-10',
          },
        ];
      }
      if (path === 'current/todoist') {
        return {
          taskCount: 1,
          tasks: [
            {
              id: 'todo-mid',
              content: 'Mid Task',
              description: '',
              dueDate: '2026-03-12',
              labels: [],
              priority: 1,
              projectId: 'p1',
            },
          ],
        };
      }
      if (path === 'current/clickup') {
        return {
          taskCount: 1,
          tasks: [
            {
              id: 'click-undated',
              name: 'Undated Task',
              status: 'open',
              date_created: '1767165871221',
              taxonomy: {},
            },
          ],
        };
      }
      return null;
    });

    const events = service.getUpcomingEvents();
    expect(events).toHaveLength(4);
    // Sorted: early (03-10), mid (03-12), later (03-15), undated (null)
    expect(events[0].id).toBe('cal-early');
    expect(events[1].id).toBe('todo-mid');
    expect(events[2].id).toBe('cal-later');
    expect(events[3].id).toBe('click-undated');
    expect(events[3].start).toBeNull();
  });

  it('uses configService.getHeadOfHousehold() when no username provided', () => {
    service.getUpcomingEvents();

    expect(mockConfigService.getHeadOfHousehold).toHaveBeenCalled();
    expect(mockDataService.user.read).toHaveBeenCalledWith('current/calendar', 'kckern');
    expect(mockDataService.user.read).toHaveBeenCalledWith('current/todoist', 'kckern');
    expect(mockDataService.user.read).toHaveBeenCalledWith('current/clickup', 'kckern');
  });

  it('uses provided username instead of head of household', () => {
    service.getUpcomingEvents('otheruser');

    expect(mockConfigService.getHeadOfHousehold).not.toHaveBeenCalled();
    expect(mockDataService.user.read).toHaveBeenCalledWith('current/calendar', 'otheruser');
    expect(mockDataService.user.read).toHaveBeenCalledWith('current/todoist', 'otheruser');
    expect(mockDataService.user.read).toHaveBeenCalledWith('current/clickup', 'otheruser');
  });

  it('handles null data gracefully from each source', () => {
    // All sources return null (default mock behavior)
    expect(() => service.getUpcomingEvents()).not.toThrow();
    expect(service.getUpcomingEvents()).toEqual([]);
  });
});
