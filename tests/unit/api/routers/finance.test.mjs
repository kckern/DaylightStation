// tests/unit/api/routers/finance.test.mjs
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createFinanceRouter } from '../../../../backend/src/4_api/routers/finance.mjs';

describe('Finance API Router', () => {
  let app;
  let mockBuxferAdapter;
  let mockFinanceStore;
  let mockHarvestService;
  let mockCompilationService;
  let mockCategorizationService;
  let mockConfigService;
  let mockLogger;

  const testFinanceConfig = {
    budget: [
      {
        label: 'Q1 2026',
        timeframe: { start: '2026-01-01', end: '2026-03-31' },
        accounts: ['Checking', 'Credit Card']
      }
    ],
    mortgage: {
      accountId: 'mortgage-123',
      interestRate: 0.065
    }
  };

  const testFinancesData = {
    budgets: {
      '2026-01-01': {
        budgetStart: '2026-01-01',
        budgetEnd: '2026-03-31',
        accounts: ['Checking', 'Credit Card'],
        totalBudget: { income: 5000, spending: 2500 },
        shortTermStatus: { budget: 1000, spending: 500, balance: 500 },
        dayToDayBudget: {
          '2026-01': {
            spending: 500,
            budget: 800,
            balance: 300
          }
        }
      }
    },
    mortgage: {
      balance: 250000,
      interestRate: 0.065,
      totalPaid: 50000,
      paymentPlans: []
    }
  };

  const testAccountBalances = [
    { name: 'Checking', balance: 5000 },
    { name: 'Credit Card', balance: -500 }
  ];

  const testTransactions = [
    { id: '1', date: '2026-01-15', amount: 50, description: 'Groceries' }
  ];

  beforeEach(() => {
    mockBuxferAdapter = {
      isConfigured: jest.fn().mockReturnValue(true),
      getMetrics: jest.fn().mockReturnValue({
        uptime: { ms: 1000, formatted: '0h 0m 1s' },
        totals: { requests: 10, errors: 0 },
        authenticated: true
      }),
      getAccountBalances: jest.fn().mockResolvedValue([
        { toJSON: () => ({ id: 1, name: 'Checking', balance: 5000 }) }
      ]),
      findByCategory: jest.fn().mockResolvedValue([]),
      findByAccount: jest.fn().mockResolvedValue([]),
      findInRange: jest.fn().mockResolvedValue([]),
      updateTransaction: jest.fn().mockResolvedValue({ success: true })
    };

    mockFinanceStore = {
      getBudgetConfig: jest.fn().mockReturnValue(testFinanceConfig),
      getCompiledFinances: jest.fn().mockReturnValue(testFinancesData),
      getAccountBalances: jest.fn().mockReturnValue(testAccountBalances),
      getTransactions: jest.fn().mockReturnValue(testTransactions),
      listBudgetPeriods: jest.fn().mockReturnValue(['2026-01-01']),
      getMemos: jest.fn().mockReturnValue({ '1': 'Test memo' }),
      saveMemo: jest.fn()
    };

    mockHarvestService = {
      harvest: jest.fn().mockResolvedValue({
        status: 'success',
        details: { budgetPeriods: [], accountBalances: 2 }
      })
    };

    mockCompilationService = {
      compile: jest.fn().mockResolvedValue({
        budgets: { '2026-01-01': {} },
        mortgage: {}
      })
    };

    mockCategorizationService = {
      categorize: jest.fn().mockResolvedValue({ processed: [], failed: [], skipped: [] }),
      preview: jest.fn().mockResolvedValue({ suggestions: [], failed: [] })
    };

    mockConfigService = {
      getDefaultHouseholdId: jest.fn().mockReturnValue('default')
    };

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    const router = createFinanceRouter({
      buxferAdapter: mockBuxferAdapter,
      financeStore: mockFinanceStore,
      harvestService: mockHarvestService,
      compilationService: mockCompilationService,
      categorizationService: mockCategorizationService,
      configService: mockConfigService,
      logger: mockLogger
    });

    app = express();
    app.use(express.json());
    app.use('/api/finance', router);
  });

  describe('GET /api/finance', () => {
    test('returns finance config overview', async () => {
      const res = await request(app).get('/api/finance');

      expect(res.status).toBe(200);
      expect(res.body.household).toBe('default');
      expect(res.body.budgetCount).toBe(1);
      expect(res.body.hasMortgage).toBe(true);
      expect(res.body.configured).toBe(true);
    });

    test('returns 404 when config not found', async () => {
      mockFinanceStore.getBudgetConfig.mockReturnValue(null);

      const res = await request(app).get('/api/finance');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Finance configuration not found');
    });

    test('accepts household query param', async () => {
      const res = await request(app).get('/api/finance?household=other');

      expect(mockFinanceStore.getBudgetConfig).toHaveBeenCalledWith('other');
    });
  });

  describe('GET /api/finance/data', () => {
    test('returns compiled finances (legacy endpoint)', async () => {
      const res = await request(app).get('/api/finance/data');

      expect(res.status).toBe(200);
      expect(res.body.budgets).toBeDefined();
      expect(res.body.mortgage).toBeDefined();
    });

    test('returns 404 when finances not found', async () => {
      mockFinanceStore.getCompiledFinances.mockReturnValue(null);

      const res = await request(app).get('/api/finance/data');

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/finance/data/daytoday', () => {
    test('returns current day-to-day budget', async () => {
      const res = await request(app).get('/api/finance/data/daytoday');

      expect(res.status).toBe(200);
      expect(res.body.spending).toBe(500);
      expect(res.body.budget).toBe(800);
      expect(res.body.balance).toBe(300);
    });

    test('removes transactions from response', async () => {
      mockFinanceStore.getCompiledFinances.mockReturnValue({
        budgets: {
          '2026-01-01': {
            dayToDayBudget: {
              '2026-01': {
                spending: 500,
                budget: 800,
                transactions: [{ id: 1 }]
              }
            }
          }
        }
      });

      const res = await request(app).get('/api/finance/data/daytoday');

      expect(res.status).toBe(200);
      expect(res.body.transactions).toBeUndefined();
    });
  });

  describe('GET /api/finance/accounts', () => {
    test('returns cached account balances', async () => {
      const res = await request(app).get('/api/finance/accounts');

      expect(res.status).toBe(200);
      expect(res.body.accounts).toHaveLength(2);
      expect(res.body.source).toBe('cache');
    });

    test('refreshes from Buxfer when requested', async () => {
      const res = await request(app).get('/api/finance/accounts?refresh=true');

      expect(res.status).toBe(200);
      expect(res.body.source).toBe('buxfer');
      expect(mockBuxferAdapter.getAccountBalances).toHaveBeenCalled();
    });
  });

  describe('GET /api/finance/transactions', () => {
    test('returns transactions from cache', async () => {
      const res = await request(app).get('/api/finance/transactions');

      expect(res.status).toBe(200);
      expect(res.body.transactions).toHaveLength(1);
      expect(res.body.count).toBe(1);
    });

    test('fetches by budget date', async () => {
      const res = await request(app).get('/api/finance/transactions?budgetDate=2026-01-01');

      expect(res.status).toBe(200);
      expect(mockFinanceStore.getTransactions).toHaveBeenCalledWith('2026-01-01', 'default');
    });

    test('fetches by category from Buxfer', async () => {
      mockBuxferAdapter.findByCategory.mockResolvedValue([
        { toJSON: () => ({ id: 1, category: 'Food' }) }
      ]);

      const res = await request(app).get(
        '/api/finance/transactions?category=Food&startDate=2026-01-01&endDate=2026-01-31'
      );

      expect(res.status).toBe(200);
      expect(mockBuxferAdapter.findByCategory).toHaveBeenCalledWith(
        'Food',
        '2026-01-01',
        '2026-01-31'
      );
    });
  });

  describe('POST /api/finance/transactions/:id', () => {
    test('updates transaction', async () => {
      const res = await request(app)
        .post('/api/finance/transactions/123')
        .send({ description: 'Updated', tags: ['Food'] });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(mockBuxferAdapter.updateTransaction).toHaveBeenCalledWith(
        '123',
        expect.objectContaining({ description: 'Updated' })
      );
    });

    test('returns 503 when adapter not configured', async () => {
      mockBuxferAdapter.isConfigured.mockReturnValue(false);

      const res = await request(app)
        .post('/api/finance/transactions/123')
        .send({ description: 'Updated' });

      expect(res.status).toBe(503);
    });
  });

  describe('GET /api/finance/budgets', () => {
    test('returns budget list', async () => {
      const res = await request(app).get('/api/finance/budgets');

      expect(res.status).toBe(200);
      expect(res.body.budgets).toHaveLength(1);
      expect(res.body.budgets[0].startDate).toBe('2026-01-01');
    });

    test('returns 404 when no budgets', async () => {
      mockFinanceStore.getCompiledFinances.mockReturnValue(null);

      const res = await request(app).get('/api/finance/budgets');

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/finance/budgets/:budgetId', () => {
    test('returns specific budget', async () => {
      const res = await request(app).get('/api/finance/budgets/2026-01-01');

      expect(res.status).toBe(200);
      expect(res.body.budget.budgetStart).toBe('2026-01-01');
      expect(res.body.budgetId).toBe('2026-01-01');
    });

    test('returns 404 for unknown budget', async () => {
      const res = await request(app).get('/api/finance/budgets/1999-01-01');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Budget not found');
    });
  });

  describe('GET /api/finance/mortgage', () => {
    test('returns mortgage data', async () => {
      const res = await request(app).get('/api/finance/mortgage');

      expect(res.status).toBe(200);
      expect(res.body.mortgage.balance).toBe(250000);
      expect(res.body.mortgage.interestRate).toBe(0.065);
    });

    test('returns 404 when mortgage not found', async () => {
      mockFinanceStore.getCompiledFinances.mockReturnValue({ budgets: {} });

      const res = await request(app).get('/api/finance/mortgage');

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/finance/refresh', () => {
    test('triggers harvest service', async () => {
      const res = await request(app)
        .post('/api/finance/refresh')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(mockHarvestService.harvest).toHaveBeenCalled();
    });

    test('passes options to harvest service', async () => {
      const res = await request(app)
        .post('/api/finance/refresh')
        .send({ skipCategorization: true, skipCompilation: true });

      expect(mockHarvestService.harvest).toHaveBeenCalledWith(
        'default',
        { skipCategorization: true, skipCompilation: true }
      );
    });

    test('returns 503 when harvest service not configured', async () => {
      const routerWithoutHarvest = createFinanceRouter({
        buxferAdapter: mockBuxferAdapter,
        financeStore: mockFinanceStore,
        configService: mockConfigService,
        logger: mockLogger
      });

      const appWithoutHarvest = express();
      appWithoutHarvest.use(express.json());
      appWithoutHarvest.use('/api/finance', routerWithoutHarvest);

      const res = await request(appWithoutHarvest)
        .post('/api/finance/refresh')
        .send({});

      expect(res.status).toBe(503);
      expect(res.body.error).toContain('Harvest service not configured');
    });

    test('returns 503 when adapter not configured', async () => {
      mockBuxferAdapter.isConfigured.mockReturnValue(false);

      const res = await request(app)
        .post('/api/finance/refresh')
        .send({});

      expect(res.status).toBe(503);
    });
  });

  describe('POST /api/finance/compile', () => {
    test('triggers compilation service', async () => {
      const res = await request(app)
        .post('/api/finance/compile')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.budgetCount).toBe(1);
      expect(mockCompilationService.compile).toHaveBeenCalled();
    });

    test('returns 503 when compilation service not configured', async () => {
      const routerWithoutCompile = createFinanceRouter({
        buxferAdapter: mockBuxferAdapter,
        financeStore: mockFinanceStore,
        configService: mockConfigService,
        logger: mockLogger
      });

      const appWithoutCompile = express();
      appWithoutCompile.use(express.json());
      appWithoutCompile.use('/api/finance', routerWithoutCompile);

      const res = await request(appWithoutCompile)
        .post('/api/finance/compile')
        .send({});

      expect(res.status).toBe(503);
    });
  });

  describe('POST /api/finance/categorize', () => {
    test('triggers categorization service', async () => {
      const res = await request(app)
        .post('/api/finance/categorize')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(mockCategorizationService.categorize).toHaveBeenCalled();
    });

    test('supports preview mode', async () => {
      const res = await request(app)
        .post('/api/finance/categorize')
        .send({ preview: true });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('preview');
      expect(mockCategorizationService.preview).toHaveBeenCalled();
      expect(mockCategorizationService.categorize).not.toHaveBeenCalled();
    });

    test('accepts budgetDate parameter', async () => {
      const res = await request(app)
        .post('/api/finance/categorize')
        .send({ budgetDate: '2026-01-01' });

      expect(mockFinanceStore.getTransactions).toHaveBeenCalledWith('2026-01-01', 'default');
    });
  });

  describe('GET /api/finance/memos', () => {
    test('returns all memos', async () => {
      const res = await request(app).get('/api/finance/memos');

      expect(res.status).toBe(200);
      expect(res.body.memos).toEqual({ '1': 'Test memo' });
    });
  });

  describe('POST /api/finance/memos/:transactionId', () => {
    test('saves memo for transaction', async () => {
      const res = await request(app)
        .post('/api/finance/memos/123')
        .send({ memo: 'New memo' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(mockFinanceStore.saveMemo).toHaveBeenCalledWith('123', 'New memo', 'default');
    });
  });

  describe('GET /api/finance/metrics', () => {
    test('returns adapter metrics', async () => {
      const res = await request(app).get('/api/finance/metrics');

      expect(res.status).toBe(200);
      expect(res.body.adapter).toBe('buxfer');
      expect(res.body.configured).toBe(true);
      expect(res.body.totals).toBeDefined();
    });

    test('handles missing adapter', async () => {
      const routerWithoutAdapter = createFinanceRouter({
        buxferAdapter: null,
        financeStore: mockFinanceStore,
        configService: mockConfigService,
        logger: mockLogger
      });

      const appWithoutAdapter = express();
      appWithoutAdapter.use(express.json());
      appWithoutAdapter.use('/api/finance', routerWithoutAdapter);

      const res = await request(appWithoutAdapter).get('/api/finance/metrics');

      expect(res.status).toBe(200);
      expect(res.body.configured).toBe(false);
    });
  });
});
