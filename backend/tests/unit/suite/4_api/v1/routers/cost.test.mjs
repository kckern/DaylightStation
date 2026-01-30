import { describe, it, expect, beforeEach, vi } from 'vitest';
import createCostRouter from '../../../../../../src/4_api/v1/routers/cost.mjs';

describe('createCostRouter', () => {
  let mockReportingService;
  let mockBudgetService;
  let mockLogger;
  let mockReq;
  let mockRes;
  let mockNext;

  beforeEach(() => {
    mockReportingService = {
      getDashboard: vi.fn().mockResolvedValue({
        period: { start: new Date(), end: new Date() },
        totalSpend: 100,
        categoryBreakdown: { ai: 50, energy: 50 },
        budgetStatuses: [],
        entryCount: 10
      }),
      getSpendByCategory: vi.fn().mockResolvedValue([
        { category: 'ai/openai', amount: 50 },
        { category: 'energy', amount: 30 }
      ]),
      getSpendByUser: vi.fn().mockResolvedValue([
        { userId: 'user-1', amount: 60 },
        { userId: 'system', amount: 40 }
      ]),
      getSpendByResource: vi.fn().mockResolvedValue([
        { resource: 'gpt-4o', amount: 30 },
        { resource: 'claude-3-opus', amount: 20 }
      ]),
      getEntries: vi.fn().mockResolvedValue({
        entries: [],
        total: 0,
        page: 1,
        limit: 50
      })
    };

    mockBudgetService = {
      evaluateBudgets: vi.fn().mockResolvedValue([
        { budgetId: 'budget-1', spent: 50, limit: 100, percentSpent: 50 }
      ])
    };

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    };

    mockReq = {
      query: {}
    };

    mockRes = {
      json: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis()
    };

    mockNext = vi.fn();
  });

  describe('factory function', () => {
    it('should require reportingService', () => {
      expect(() => createCostRouter({
        budgetService: mockBudgetService
      })).toThrow('reportingService is required');
    });

    it('should create router with required dependencies', () => {
      const router = createCostRouter({
        reportingService: mockReportingService
      });

      expect(router).toBeDefined();
      expect(typeof router).toBe('function');
    });

    it('should create router with all dependencies', () => {
      const router = createCostRouter({
        reportingService: mockReportingService,
        budgetService: mockBudgetService,
        logger: mockLogger
      });

      expect(router).toBeDefined();
    });

    it('should work without budgetService', () => {
      const router = createCostRouter({
        reportingService: mockReportingService,
        logger: mockLogger
      });

      expect(router).toBeDefined();
    });
  });

  describe('routes', () => {
    let router;

    beforeEach(() => {
      router = createCostRouter({
        reportingService: mockReportingService,
        budgetService: mockBudgetService,
        logger: mockLogger
      });
    });

    it('should have dashboard route', () => {
      const dashboardRoute = router.stack.find(
        layer => layer.route && layer.route.path === '/dashboard'
      );
      expect(dashboardRoute).toBeDefined();
      expect(dashboardRoute.route.methods.get).toBe(true);
    });

    it('should have spend/category route', () => {
      const route = router.stack.find(
        layer => layer.route && layer.route.path === '/spend/category'
      );
      expect(route).toBeDefined();
      expect(route.route.methods.get).toBe(true);
    });

    it('should have spend/user route', () => {
      const route = router.stack.find(
        layer => layer.route && layer.route.path === '/spend/user'
      );
      expect(route).toBeDefined();
      expect(route.route.methods.get).toBe(true);
    });

    it('should have spend/resource route', () => {
      const route = router.stack.find(
        layer => layer.route && layer.route.path === '/spend/resource'
      );
      expect(route).toBeDefined();
      expect(route.route.methods.get).toBe(true);
    });

    it('should have entries route', () => {
      const route = router.stack.find(
        layer => layer.route && layer.route.path === '/entries'
      );
      expect(route).toBeDefined();
      expect(route.route.methods.get).toBe(true);
    });

    it('should have budgets route', () => {
      const route = router.stack.find(
        layer => layer.route && layer.route.path === '/budgets'
      );
      expect(route).toBeDefined();
      expect(route.route.methods.get).toBe(true);
    });
  });

  describe('GET /dashboard', () => {
    let handler;

    beforeEach(() => {
      const router = createCostRouter({
        reportingService: mockReportingService,
        budgetService: mockBudgetService,
        logger: mockLogger
      });

      const route = router.stack.find(
        layer => layer.route && layer.route.path === '/dashboard'
      );
      handler = route.route.stack[0].handle;
    });

    it('should call reportingService.getDashboard', async () => {
      mockReq.query = { household: 'test-household', period: '2026-01' };

      await handler(mockReq, mockRes, mockNext);

      expect(mockReportingService.getDashboard).toHaveBeenCalledWith(
        'test-household',
        expect.objectContaining({
          start: expect.any(Date),
          end: expect.any(Date)
        })
      );
    });

    it('should use default household when not provided', async () => {
      mockReq.query = {};

      await handler(mockReq, mockRes, mockNext);

      expect(mockReportingService.getDashboard).toHaveBeenCalledWith(
        'default',
        expect.any(Object)
      );
    });

    it('should return dashboard data', async () => {
      await handler(mockReq, mockRes, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          totalSpend: 100,
          entryCount: 10
        })
      );
    });

    it('should call next on error', async () => {
      const error = new Error('Service error');
      mockReportingService.getDashboard.mockRejectedValue(error);

      await handler(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  describe('GET /spend/category', () => {
    let handler;

    beforeEach(() => {
      const router = createCostRouter({
        reportingService: mockReportingService,
        budgetService: mockBudgetService,
        logger: mockLogger
      });

      const route = router.stack.find(
        layer => layer.route && layer.route.path === '/spend/category'
      );
      handler = route.route.stack[0].handle;
    });

    it('should call reportingService.getSpendByCategory', async () => {
      mockReq.query = { household: 'test', period: '2026-01', depth: '3' };

      await handler(mockReq, mockRes, mockNext);

      expect(mockReportingService.getSpendByCategory).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({
          start: expect.any(Date),
          end: expect.any(Date)
        }),
        3
      );
    });

    it('should use default depth of 2', async () => {
      mockReq.query = { household: 'test' };

      await handler(mockReq, mockRes, mockNext);

      expect(mockReportingService.getSpendByCategory).toHaveBeenCalledWith(
        'test',
        expect.any(Object),
        2
      );
    });

    it('should call next on error', async () => {
      const error = new Error('Category error');
      mockReportingService.getSpendByCategory.mockRejectedValue(error);

      await handler(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  describe('GET /spend/user', () => {
    let handler;

    beforeEach(() => {
      const router = createCostRouter({
        reportingService: mockReportingService,
        budgetService: mockBudgetService,
        logger: mockLogger
      });

      const route = router.stack.find(
        layer => layer.route && layer.route.path === '/spend/user'
      );
      handler = route.route.stack[0].handle;
    });

    it('should call reportingService.getSpendByUser', async () => {
      mockReq.query = { household: 'test', period: '2026-01' };

      await handler(mockReq, mockRes, mockNext);

      expect(mockReportingService.getSpendByUser).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({
          start: expect.any(Date),
          end: expect.any(Date)
        })
      );
    });

    it('should call next on error', async () => {
      const error = new Error('User error');
      mockReportingService.getSpendByUser.mockRejectedValue(error);

      await handler(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  describe('GET /spend/resource', () => {
    let handler;

    beforeEach(() => {
      const router = createCostRouter({
        reportingService: mockReportingService,
        budgetService: mockBudgetService,
        logger: mockLogger
      });

      const route = router.stack.find(
        layer => layer.route && layer.route.path === '/spend/resource'
      );
      handler = route.route.stack[0].handle;
    });

    it('should call reportingService.getSpendByResource', async () => {
      mockReq.query = { household: 'test', period: '2026-01' };

      await handler(mockReq, mockRes, mockNext);

      expect(mockReportingService.getSpendByResource).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({
          start: expect.any(Date),
          end: expect.any(Date)
        })
      );
    });

    it('should call next on error', async () => {
      const error = new Error('Resource error');
      mockReportingService.getSpendByResource.mockRejectedValue(error);

      await handler(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  describe('GET /entries', () => {
    let handler;

    beforeEach(() => {
      const router = createCostRouter({
        reportingService: mockReportingService,
        budgetService: mockBudgetService,
        logger: mockLogger
      });

      const route = router.stack.find(
        layer => layer.route && layer.route.path === '/entries'
      );
      handler = route.route.stack[0].handle;
    });

    it('should call reportingService.getEntries with filter', async () => {
      mockReq.query = {
        household: 'test',
        period: '2026-01',
        category: 'ai/openai',
        page: '2',
        limit: '25'
      };

      await handler(mockReq, mockRes, mockNext);

      expect(mockReportingService.getEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          householdId: 'test',
          category: 'ai/openai',
          start: expect.any(Date),
          end: expect.any(Date)
        }),
        { page: 2, limit: 25 }
      );
    });

    it('should use default pagination', async () => {
      mockReq.query = { household: 'test' };

      await handler(mockReq, mockRes, mockNext);

      expect(mockReportingService.getEntries).toHaveBeenCalledWith(
        expect.any(Object),
        { page: 1, limit: 50 }
      );
    });

    it('should call next on error', async () => {
      const error = new Error('Entries error');
      mockReportingService.getEntries.mockRejectedValue(error);

      await handler(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  describe('GET /budgets', () => {
    let handler;

    beforeEach(() => {
      const router = createCostRouter({
        reportingService: mockReportingService,
        budgetService: mockBudgetService,
        logger: mockLogger
      });

      const route = router.stack.find(
        layer => layer.route && layer.route.path === '/budgets'
      );
      handler = route.route.stack[0].handle;
    });

    it('should call budgetService.evaluateBudgets', async () => {
      mockReq.query = { household: 'test' };

      await handler(mockReq, mockRes, mockNext);

      expect(mockBudgetService.evaluateBudgets).toHaveBeenCalledWith('test');
    });

    it('should return budgets array', async () => {
      await handler(mockReq, mockRes, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith({
        budgets: expect.arrayContaining([
          expect.objectContaining({ budgetId: 'budget-1' })
        ])
      });
    });

    it('should return empty array when budgetService is not configured', async () => {
      const router = createCostRouter({
        reportingService: mockReportingService,
        logger: mockLogger
      });

      const route = router.stack.find(
        layer => layer.route && layer.route.path === '/budgets'
      );
      const handlerWithoutBudget = route.route.stack[0].handle;

      await handlerWithoutBudget(mockReq, mockRes, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith({
        budgets: [],
        message: 'Budget service not configured'
      });
    });

    it('should call next on error', async () => {
      const error = new Error('Budget error');
      mockBudgetService.evaluateBudgets.mockRejectedValue(error);

      await handler(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  describe('period parsing', () => {
    let handler;

    beforeEach(() => {
      const router = createCostRouter({
        reportingService: mockReportingService,
        logger: mockLogger
      });

      const route = router.stack.find(
        layer => layer.route && layer.route.path === '/dashboard'
      );
      handler = route.route.stack[0].handle;
    });

    it('should parse YYYY-MM format', async () => {
      mockReq.query = { period: '2026-01' };

      await handler(mockReq, mockRes, mockNext);

      const call = mockReportingService.getDashboard.mock.calls[0];
      const period = call[1];

      expect(period.start.getFullYear()).toBe(2026);
      expect(period.start.getMonth()).toBe(0); // January
      expect(period.start.getDate()).toBe(1);
    });

    it('should parse date range format', async () => {
      mockReq.query = { period: '2026-01-15..2026-01-31' };

      await handler(mockReq, mockRes, mockNext);

      const call = mockReportingService.getDashboard.mock.calls[0];
      const period = call[1];

      // Verify start and end are Date objects and represent the expected values
      // Note: Date parsing may vary by timezone, so we check the ISO string contains the date
      expect(period.start).toBeInstanceOf(Date);
      expect(period.end).toBeInstanceOf(Date);
      expect(period.start.toISOString()).toContain('2026-01-15');
      expect(period.end.toISOString()).toContain('2026-01-31');
    });

    it('should default to current month when no period provided', async () => {
      mockReq.query = {};
      const now = new Date();

      await handler(mockReq, mockRes, mockNext);

      const call = mockReportingService.getDashboard.mock.calls[0];
      const period = call[1];

      expect(period.start.getFullYear()).toBe(now.getFullYear());
      expect(period.start.getMonth()).toBe(now.getMonth());
      expect(period.start.getDate()).toBe(1);
    });
  });
});
