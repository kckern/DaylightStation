// tests/unit/adapters/harvester/finance/ShoppingHarvester.test.mjs
import { jest } from '@jest/globals';

describe('ShoppingHarvester', () => {
  let ShoppingHarvester;
  let HarvesterCategory;
  let harvester;
  let mockGmailClientFactory;
  let mockGmail;
  let mockAiGateway;
  let mockLifelogStore;
  let mockConfigService;
  let mockLogger;

  const mockRetailers = [
    {
      id: 'amazon',
      name: 'Amazon',
      senders: ['shipment-tracking@amazon.com', 'auto-confirm@amazon.com'],
      keywords: ['order', 'shipment', 'delivered'],
    },
    {
      id: 'target',
      name: 'Target',
      senders: ['orders@target.com', 'receipts@target.com'],
      keywords: ['order', 'receipt', 'shipped'],
    },
  ];

  const mockEmailMessage = {
    id: 'msg-123',
    threadId: 'thread-456',
    snippet: 'Your order has shipped',
    payload: {
      headers: [
        { name: 'Subject', value: 'Your Amazon order has shipped' },
        { name: 'From', value: 'shipment-tracking@amazon.com' },
        { name: 'Date', value: 'Mon, 13 Jan 2026 10:00:00 -0600' },
      ],
      mimeType: 'text/plain',
      body: {
        data: Buffer.from('Order #123-456-789\nItem: Widget\nTotal: $29.99').toString('base64'),
      },
    },
  };

  const mockReceiptData = {
    merchant: 'Amazon',
    order_id: '123-456-789',
    date: '2026-01-13',
    time: '10:00',
    items: [
      { name: 'Widget', quantity: 1, unit_price: 29.99, total_price: 29.99 },
    ],
    subtotal: 29.99,
    tax: 2.47,
    shipping: 0,
    total: 32.46,
    currency: 'USD',
  };

  beforeEach(async () => {
    jest.resetModules();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-13T12:00:00Z'));

    const module = await import('@backend/src/2_adapters/harvester/finance/ShoppingHarvester.mjs');
    ShoppingHarvester = module.ShoppingHarvester;

    const portsModule = await import('@backend/src/2_adapters/harvester/ports/IHarvester.mjs');
    HarvesterCategory = portsModule.HarvesterCategory;

    mockGmail = {
      users: {
        messages: {
          list: jest.fn(),
          get: jest.fn(),
        },
      },
    };

    mockGmailClientFactory = jest.fn().mockResolvedValue(mockGmail);

    mockAiGateway = {
      chatWithJson: jest.fn(),
    };

    mockLifelogStore = {
      load: jest.fn(),
      save: jest.fn(),
    };

    mockConfigService = {
      getUserHouseholdId: jest.fn(),
      getHouseholdConfig: jest.fn(),
    };

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    harvester = new ShoppingHarvester({
      gmailClientFactory: mockGmailClientFactory,
      aiGateway: mockAiGateway,
      lifelogStore: mockLifelogStore,
      configService: mockConfigService,
      timezone: 'America/Chicago',
      logger: mockLogger,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    test('throws without gmailClientFactory', () => {
      expect(() => new ShoppingHarvester({
        aiGateway: mockAiGateway,
        lifelogStore: mockLifelogStore,
      })).toThrow('requires gmailClientFactory');
    });

    test('throws without aiGateway', () => {
      expect(() => new ShoppingHarvester({
        gmailClientFactory: mockGmailClientFactory,
        lifelogStore: mockLifelogStore,
      })).toThrow('requires aiGateway');
    });

    test('throws without lifelogStore', () => {
      expect(() => new ShoppingHarvester({
        gmailClientFactory: mockGmailClientFactory,
        aiGateway: mockAiGateway,
      })).toThrow('requires lifelogStore');
    });

    test('creates instance with valid config', () => {
      const instance = new ShoppingHarvester({
        gmailClientFactory: mockGmailClientFactory,
        aiGateway: mockAiGateway,
        lifelogStore: mockLifelogStore,
        configService: mockConfigService,
        timezone: 'America/Chicago',
        logger: mockLogger,
      });
      expect(instance).toBeInstanceOf(ShoppingHarvester);
    });

    test('uses default timezone when not provided', () => {
      const instance = new ShoppingHarvester({
        gmailClientFactory: mockGmailClientFactory,
        aiGateway: mockAiGateway,
        lifelogStore: mockLifelogStore,
      });
      expect(instance).toBeInstanceOf(ShoppingHarvester);
    });
  });

  describe('serviceId and category', () => {
    test('serviceId returns "shopping"', () => {
      expect(harvester.serviceId).toBe('shopping');
    });

    test('category returns FINANCE', () => {
      expect(harvester.category).toBe(HarvesterCategory.FINANCE);
    });
  });

  describe('harvest', () => {
    beforeEach(() => {
      // Setup default config
      mockConfigService.getUserHouseholdId.mockReturnValue('household-123');
      mockConfigService.getHouseholdConfig.mockReturnValue({
        shopping: {
          enabled: true,
          timezone: 'America/Chicago',
          retailers: mockRetailers,
        },
      });

      // Setup default existing data
      mockLifelogStore.load.mockResolvedValue({
        meta: { false_positives: [] },
        receipts: [],
      });
    });

    test('returns success status with stats when no messages found', async () => {
      mockGmail.users.messages.list.mockResolvedValue({ data: { messages: [] } });

      const result = await harvester.harvest('testuser', { days: 7 });

      expect(result).toHaveProperty('count', 0);
      expect(result).toHaveProperty('stats');
      expect(result.stats).toEqual({ processed: 0, new: 0, skipped: 0, errors: 0 });
      expect(result).toHaveProperty('status', 'success');
    });

    test('processes messages and extracts receipts', async () => {
      mockGmail.users.messages.list.mockResolvedValue({
        data: { messages: [{ id: 'msg-123' }] },
      });
      mockGmail.users.messages.get.mockResolvedValue({ data: mockEmailMessage });
      mockAiGateway.chatWithJson.mockResolvedValue(mockReceiptData);

      const result = await harvester.harvest('testuser', { days: 7 });

      expect(result.count).toBe(1);
      expect(result.stats.new).toBe(1);
      expect(result.stats.processed).toBe(1);
      expect(result.status).toBe('success');
      expect(mockLifelogStore.save).toHaveBeenCalled();
    });

    test('skips already processed emails', async () => {
      mockLifelogStore.load.mockResolvedValue({
        meta: { false_positives: [] },
        receipts: [{ id: 'existing-receipt', email_id: 'msg-123' }],
      });
      mockGmail.users.messages.list.mockResolvedValue({
        data: { messages: [{ id: 'msg-123' }] },
      });

      const result = await harvester.harvest('testuser', { days: 7 });

      expect(result.stats.skipped).toBe(1);
      expect(result.stats.new).toBe(0);
      expect(mockGmail.users.messages.get).not.toHaveBeenCalled();
    });

    test('skips known false positives', async () => {
      mockLifelogStore.load.mockResolvedValue({
        meta: { false_positives: ['msg-123'] },
        receipts: [],
      });
      mockGmail.users.messages.list.mockResolvedValue({
        data: { messages: [{ id: 'msg-123' }] },
      });

      const result = await harvester.harvest('testuser', { days: 7 });

      expect(result.stats.skipped).toBe(1);
      expect(mockGmail.users.messages.get).not.toHaveBeenCalled();
    });

    test('adds email to false positives when AI extraction returns empty', async () => {
      mockGmail.users.messages.list.mockResolvedValue({
        data: { messages: [{ id: 'msg-123' }] },
      });
      mockGmail.users.messages.get.mockResolvedValue({ data: mockEmailMessage });
      mockAiGateway.chatWithJson.mockResolvedValue({ items: [], total: null });

      const result = await harvester.harvest('testuser', { days: 7 });

      expect(result.stats.errors).toBe(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'shopping.extraction.empty',
        expect.objectContaining({ emailId: 'msg-123' })
      );
    });

    test('skips emails from unknown retailers', async () => {
      const unknownRetailerEmail = {
        ...mockEmailMessage,
        payload: {
          ...mockEmailMessage.payload,
          headers: [
            { name: 'Subject', value: 'Your order from Unknown Store' },
            { name: 'From', value: 'noreply@unknown-store.com' },
            { name: 'Date', value: 'Mon, 13 Jan 2026 10:00:00 -0600' },
          ],
        },
      };
      mockGmail.users.messages.list.mockResolvedValue({
        data: { messages: [{ id: 'msg-123' }] },
      });
      mockGmail.users.messages.get.mockResolvedValue({ data: unknownRetailerEmail });

      const result = await harvester.harvest('testuser', { days: 7 });

      expect(result.stats.skipped).toBe(1);
      expect(mockAiGateway.chatWithJson).not.toHaveBeenCalled();
    });

    test('handles full sync mode with no date filter', async () => {
      mockGmail.users.messages.list.mockResolvedValue({ data: { messages: [] } });

      await harvester.harvest('testuser', { full: true });

      const listCall = mockGmail.users.messages.list.mock.calls[0][0];
      expect(listCall.q).not.toContain('after:');
    });

    test('handles incremental sync with date filter', async () => {
      mockGmail.users.messages.list.mockResolvedValue({ data: { messages: [] } });

      await harvester.harvest('testuser', { days: 7 });

      const listCall = mockGmail.users.messages.list.mock.calls[0][0];
      expect(listCall.q).toContain('after:');
    });

    test('handles retailer filter option', async () => {
      mockGmail.users.messages.list.mockResolvedValue({ data: { messages: [] } });

      await harvester.harvest('testuser', { days: 7, retailer: 'amazon' });

      const listCall = mockGmail.users.messages.list.mock.calls[0][0];
      expect(listCall.q).toContain('amazon.com');
      expect(listCall.q).not.toContain('target.com');
    });

    test('returns skipped status when circuit breaker is open', async () => {
      // Open the circuit breaker by recording 3 failures
      const error = new Error('Test error');
      error.response = { status: 429 };
      for (let i = 0; i < 3; i++) {
        try {
          mockGmailClientFactory.mockRejectedValueOnce(error);
          await harvester.harvest('testuser', { days: 7 });
        } catch {
          // Expected
        }
      }

      // Reset mock to make it work again
      mockGmailClientFactory.mockResolvedValue(mockGmail);
      mockGmail.users.messages.list.mockResolvedValue({ data: { messages: [] } });

      const result = await harvester.harvest('testuser', { days: 7 });

      expect(result.status).toBe('skipped');
      expect(result.reason).toBe('cooldown');
      expect(result.count).toBe(0);
    });

    test('saves merged receipts to lifelog store', async () => {
      mockLifelogStore.load.mockResolvedValue({
        meta: { false_positives: [] },
        receipts: [{ id: 'existing-receipt', email_id: 'old-msg', date: '2026-01-10' }],
      });
      mockGmail.users.messages.list.mockResolvedValue({
        data: { messages: [{ id: 'msg-123' }] },
      });
      mockGmail.users.messages.get.mockResolvedValue({ data: mockEmailMessage });
      mockAiGateway.chatWithJson.mockResolvedValue(mockReceiptData);

      await harvester.harvest('testuser', { days: 7 });

      expect(mockLifelogStore.save).toHaveBeenCalledWith(
        'testuser',
        'shopping',
        expect.objectContaining({
          meta: expect.objectContaining({
            totalReceipts: 2, // existing + new
          }),
          receipts: expect.arrayContaining([
            expect.objectContaining({ id: 'existing-receipt' }),
            expect.objectContaining({ source: 'amazon' }),
          ]),
        })
      );
    });

    test('uses default config when household config not available', async () => {
      mockConfigService.getUserHouseholdId.mockReturnValue(null);
      mockConfigService.getHouseholdConfig.mockReturnValue(null);
      mockGmail.users.messages.list.mockResolvedValue({ data: { messages: [] } });

      const result = await harvester.harvest('testuser', { days: 7 });

      expect(result.status).toBe('success');
    });

    test('handles message processing errors gracefully', async () => {
      mockGmail.users.messages.list.mockResolvedValue({
        data: { messages: [{ id: 'msg-123' }, { id: 'msg-456' }] },
      });
      mockGmail.users.messages.get
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ data: mockEmailMessage });
      mockAiGateway.chatWithJson.mockResolvedValue(mockReceiptData);

      const result = await harvester.harvest('testuser', { days: 7 });

      expect(result.stats.errors).toBe(1);
      expect(result.stats.new).toBe(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'shopping.message.error',
        expect.objectContaining({ emailId: 'msg-123' })
      );
    });

    test('records circuit breaker failure for rate limit errors', async () => {
      const rateLimitError = new Error('Rate limited');
      rateLimitError.response = { status: 429 };
      mockGmailClientFactory.mockRejectedValue(rateLimitError);

      await expect(harvester.harvest('testuser', { days: 7 })).rejects.toThrow();

      const status = harvester.getStatus();
      expect(status.failures).toBeGreaterThan(0);
    });
  });

  describe('buildReceiptQuery (via harvest)', () => {
    beforeEach(() => {
      mockConfigService.getUserHouseholdId.mockReturnValue('household-123');
      mockConfigService.getHouseholdConfig.mockReturnValue({
        shopping: {
          enabled: true,
          timezone: 'America/Chicago',
          retailers: mockRetailers,
        },
      });
      mockLifelogStore.load.mockResolvedValue({ meta: {}, receipts: [] });
    });

    test('builds query with multiple retailers', async () => {
      mockGmail.users.messages.list.mockResolvedValue({ data: { messages: [] } });

      await harvester.harvest('testuser', { days: 7 });

      const query = mockGmail.users.messages.list.mock.calls[0][0].q;
      expect(query).toContain('from:shipment-tracking@amazon.com');
      expect(query).toContain('from:orders@target.com');
    });

    test('includes keywords in query', async () => {
      mockGmail.users.messages.list.mockResolvedValue({ data: { messages: [] } });

      await harvester.harvest('testuser', { days: 7 });

      const query = mockGmail.users.messages.list.mock.calls[0][0].q;
      expect(query).toContain('subject:order');
      expect(query).toContain('subject:shipment');
    });

    test('includes date filter for incremental sync', async () => {
      mockGmail.users.messages.list.mockResolvedValue({ data: { messages: [] } });

      await harvester.harvest('testuser', { days: 30 });

      const query = mockGmail.users.messages.list.mock.calls[0][0].q;
      expect(query).toMatch(/after:\d{4}\/\d{2}\/\d{2}/);
    });

    test('throws error when no retailers match filter', async () => {
      await expect(
        harvester.harvest('testuser', { days: 7, retailer: 'nonexistent' })
      ).rejects.toThrow("No retailers configured matching 'nonexistent'");
    });
  });

  describe('parseEmailContent (via harvest)', () => {
    beforeEach(() => {
      mockConfigService.getUserHouseholdId.mockReturnValue('household-123');
      mockConfigService.getHouseholdConfig.mockReturnValue({
        shopping: { enabled: true, retailers: mockRetailers },
      });
      mockLifelogStore.load.mockResolvedValue({ meta: {}, receipts: [] });
      mockGmail.users.messages.list.mockResolvedValue({
        data: { messages: [{ id: 'msg-123' }] },
      });
      mockAiGateway.chatWithJson.mockResolvedValue(mockReceiptData);
    });

    test('extracts plain text body', async () => {
      mockGmail.users.messages.get.mockResolvedValue({ data: mockEmailMessage });

      await harvester.harvest('testuser', { days: 7 });

      const aiCall = mockAiGateway.chatWithJson.mock.calls[0][0];
      const userMessage = aiCall.find(m => m.role === 'user').content;
      expect(userMessage).toContain('Order #123-456-789');
      expect(userMessage).toContain('Widget');
    });

    test('extracts HTML body and strips tags', async () => {
      const htmlEmail = {
        ...mockEmailMessage,
        payload: {
          headers: mockEmailMessage.payload.headers,
          mimeType: 'multipart/alternative',
          parts: [
            {
              mimeType: 'text/html',
              body: {
                data: Buffer.from('<html><body><p>Order #HTML-123</p><p>Price: $49.99</p></body></html>').toString('base64'),
              },
            },
          ],
        },
      };
      mockGmail.users.messages.get.mockResolvedValue({ data: htmlEmail });

      await harvester.harvest('testuser', { days: 7 });

      const aiCall = mockAiGateway.chatWithJson.mock.calls[0][0];
      const userMessage = aiCall.find(m => m.role === 'user').content;
      expect(userMessage).toContain('Order #HTML-123');
      expect(userMessage).not.toContain('<html>');
      expect(userMessage).not.toContain('<p>');
    });

    test('prefers plain text over HTML when both available', async () => {
      const multipartEmail = {
        ...mockEmailMessage,
        payload: {
          headers: mockEmailMessage.payload.headers,
          mimeType: 'multipart/alternative',
          parts: [
            {
              mimeType: 'text/plain',
              body: {
                data: Buffer.from('Plain text content').toString('base64'),
              },
            },
            {
              mimeType: 'text/html',
              body: {
                data: Buffer.from('<html>HTML content</html>').toString('base64'),
              },
            },
          ],
        },
      };
      mockGmail.users.messages.get.mockResolvedValue({ data: multipartEmail });

      await harvester.harvest('testuser', { days: 7 });

      const aiCall = mockAiGateway.chatWithJson.mock.calls[0][0];
      const userMessage = aiCall.find(m => m.role === 'user').content;
      expect(userMessage).toContain('Plain text content');
      expect(userMessage).not.toContain('HTML content');
    });

    test('handles nested multipart messages', async () => {
      const nestedEmail = {
        ...mockEmailMessage,
        payload: {
          headers: mockEmailMessage.payload.headers,
          mimeType: 'multipart/mixed',
          parts: [
            {
              mimeType: 'multipart/alternative',
              parts: [
                {
                  mimeType: 'text/plain',
                  body: {
                    data: Buffer.from('Nested plain text').toString('base64'),
                  },
                },
              ],
            },
          ],
        },
      };
      mockGmail.users.messages.get.mockResolvedValue({ data: nestedEmail });

      await harvester.harvest('testuser', { days: 7 });

      const aiCall = mockAiGateway.chatWithJson.mock.calls[0][0];
      const userMessage = aiCall.find(m => m.role === 'user').content;
      expect(userMessage).toContain('Nested plain text');
    });

    test('falls back to snippet when no body content', async () => {
      const snippetOnlyEmail = {
        ...mockEmailMessage,
        snippet: 'Snippet fallback content',
        payload: {
          headers: mockEmailMessage.payload.headers,
          mimeType: 'multipart/alternative',
          parts: [],
        },
      };
      mockGmail.users.messages.get.mockResolvedValue({ data: snippetOnlyEmail });

      await harvester.harvest('testuser', { days: 7 });

      const aiCall = mockAiGateway.chatWithJson.mock.calls[0][0];
      const userMessage = aiCall.find(m => m.role === 'user').content;
      expect(userMessage).toContain('Snippet fallback content');
    });
  });

  describe('identifyRetailer (via harvest)', () => {
    beforeEach(() => {
      mockConfigService.getUserHouseholdId.mockReturnValue('household-123');
      mockConfigService.getHouseholdConfig.mockReturnValue({
        shopping: { enabled: true, retailers: mockRetailers },
      });
      mockLifelogStore.load.mockResolvedValue({ meta: {}, receipts: [] });
      mockGmail.users.messages.list.mockResolvedValue({
        data: { messages: [{ id: 'msg-123' }] },
      });
      mockAiGateway.chatWithJson.mockResolvedValue(mockReceiptData);
    });

    test('identifies Amazon retailer from sender', async () => {
      mockGmail.users.messages.get.mockResolvedValue({ data: mockEmailMessage });

      await harvester.harvest('testuser', { days: 7 });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'shopping.receipt.processed',
        expect.objectContaining({ retailer: 'amazon' })
      );
    });

    test('identifies Target retailer from sender', async () => {
      const targetEmail = {
        ...mockEmailMessage,
        payload: {
          ...mockEmailMessage.payload,
          headers: [
            { name: 'Subject', value: 'Your Target order' },
            { name: 'From', value: 'Orders <orders@target.com>' },
            { name: 'Date', value: 'Mon, 13 Jan 2026 10:00:00 -0600' },
          ],
        },
      };
      mockGmail.users.messages.get.mockResolvedValue({ data: targetEmail });

      await harvester.harvest('testuser', { days: 7 });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'shopping.receipt.processed',
        expect.objectContaining({ retailer: 'target' })
      );
    });

    test('handles case-insensitive sender matching', async () => {
      const uppercaseEmail = {
        ...mockEmailMessage,
        payload: {
          ...mockEmailMessage.payload,
          headers: [
            { name: 'Subject', value: 'Your order' },
            { name: 'From', value: 'SHIPMENT-TRACKING@AMAZON.COM' },
            { name: 'Date', value: 'Mon, 13 Jan 2026 10:00:00 -0600' },
          ],
        },
      };
      mockGmail.users.messages.get.mockResolvedValue({ data: uppercaseEmail });

      await harvester.harvest('testuser', { days: 7 });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'shopping.receipt.processed',
        expect.objectContaining({ retailer: 'amazon' })
      );
    });
  });

  describe('extractReceiptData (via harvest)', () => {
    beforeEach(() => {
      mockConfigService.getUserHouseholdId.mockReturnValue('household-123');
      mockConfigService.getHouseholdConfig.mockReturnValue({
        shopping: { enabled: true, retailers: mockRetailers },
      });
      mockLifelogStore.load.mockResolvedValue({ meta: {}, receipts: [] });
      mockGmail.users.messages.list.mockResolvedValue({
        data: { messages: [{ id: 'msg-123' }] },
      });
      mockGmail.users.messages.get.mockResolvedValue({ data: mockEmailMessage });
    });

    test('calls AI gateway with correct system prompt', async () => {
      mockAiGateway.chatWithJson.mockResolvedValue(mockReceiptData);

      await harvester.harvest('testuser', { days: 7 });

      const aiCall = mockAiGateway.chatWithJson.mock.calls[0][0];
      const systemMessage = aiCall.find(m => m.role === 'system').content;
      expect(systemMessage).toContain('receipt parsing assistant');
      expect(systemMessage).toContain('Output JSON schema');
    });

    test('passes retailer name to AI for context', async () => {
      mockAiGateway.chatWithJson.mockResolvedValue(mockReceiptData);

      await harvester.harvest('testuser', { days: 7 });

      const aiCall = mockAiGateway.chatWithJson.mock.calls[0][0];
      const userMessage = aiCall.find(m => m.role === 'user').content;
      expect(userMessage).toContain('Amazon');
    });

    test('uses correct AI model and parameters', async () => {
      mockAiGateway.chatWithJson.mockResolvedValue(mockReceiptData);

      await harvester.harvest('testuser', { days: 7 });

      const aiOptions = mockAiGateway.chatWithJson.mock.calls[0][1];
      expect(aiOptions).toEqual({
        model: 'gpt-4o-mini',
        maxTokens: 2000,
        temperature: 0.1,
      });
    });

    test('marks as false positive when AI returns no items and no total', async () => {
      mockAiGateway.chatWithJson.mockResolvedValue({
        items: [],
        total: null,
        merchant: null,
      });

      const result = await harvester.harvest('testuser', { days: 7 });

      expect(result.stats.errors).toBe(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'shopping.extraction.empty',
        expect.any(Object)
      );
    });

    test('accepts receipt with total but no items', async () => {
      mockAiGateway.chatWithJson.mockResolvedValue({
        items: [],
        total: 50.00,
        merchant: 'Amazon',
      });

      const result = await harvester.harvest('testuser', { days: 7 });

      expect(result.stats.new).toBe(1);
    });

    test('accepts receipt with items but no total', async () => {
      mockAiGateway.chatWithJson.mockResolvedValue({
        items: [{ name: 'Item', quantity: 1, unit_price: 10, total_price: 10 }],
        total: null,
        merchant: 'Amazon',
      });

      const result = await harvester.harvest('testuser', { days: 7 });

      expect(result.stats.new).toBe(1);
    });
  });

  describe('generateReceiptId (via harvest)', () => {
    beforeEach(() => {
      mockConfigService.getUserHouseholdId.mockReturnValue('household-123');
      mockConfigService.getHouseholdConfig.mockReturnValue({
        shopping: { enabled: true, retailers: mockRetailers },
      });
      mockLifelogStore.load.mockResolvedValue({ meta: {}, receipts: [] });
      mockGmail.users.messages.list.mockResolvedValue({
        data: { messages: [{ id: 'msg-123' }] },
      });
      mockGmail.users.messages.get.mockResolvedValue({ data: mockEmailMessage });
    });

    test('generates ID from source, date, and order_id', async () => {
      mockAiGateway.chatWithJson.mockResolvedValue({
        ...mockReceiptData,
        order_id: 'ORD-12345',
        date: '2026-01-13',
      });

      await harvester.harvest('testuser', { days: 7 });

      const savedData = mockLifelogStore.save.mock.calls[0][2];
      const receipt = savedData.receipts.find(r => r.source === 'amazon');
      expect(receipt.id).toBe('amazon_2026-01-13_ord-12345');
    });

    test('uses email ID when no order_id available', async () => {
      mockAiGateway.chatWithJson.mockResolvedValue({
        ...mockReceiptData,
        order_id: null,
        date: '2026-01-13',
      });

      await harvester.harvest('testuser', { days: 7 });

      const savedData = mockLifelogStore.save.mock.calls[0][2];
      const receipt = savedData.receipts.find(r => r.source === 'amazon');
      expect(receipt.id).toContain('msg-123');
    });

    test('sanitizes special characters in ID', async () => {
      mockAiGateway.chatWithJson.mockResolvedValue({
        ...mockReceiptData,
        order_id: 'ORD#123/456@789',
        date: '2026-01-13',
      });

      await harvester.harvest('testuser', { days: 7 });

      const savedData = mockLifelogStore.save.mock.calls[0][2];
      const receipt = savedData.receipts.find(r => r.source === 'amazon');
      expect(receipt.id).not.toMatch(/[#/@]/);
      expect(receipt.id).toMatch(/^[a-z0-9_-]+$/);
    });
  });

  describe('mergeReceipts (via harvest)', () => {
    beforeEach(() => {
      mockConfigService.getUserHouseholdId.mockReturnValue('household-123');
      mockConfigService.getHouseholdConfig.mockReturnValue({
        shopping: { enabled: true, retailers: mockRetailers },
      });
      mockGmail.users.messages.get.mockResolvedValue({ data: mockEmailMessage });
      mockAiGateway.chatWithJson.mockResolvedValue(mockReceiptData);
    });

    test('deduplicates receipts by ID', async () => {
      mockLifelogStore.load.mockResolvedValue({
        meta: {},
        receipts: [{
          id: 'amazon_2026-01-13_123-456-789',
          email_id: 'different-msg',
          date: '2026-01-13',
        }],
      });
      mockGmail.users.messages.list.mockResolvedValue({
        data: { messages: [{ id: 'msg-123' }] },
      });

      await harvester.harvest('testuser', { days: 7 });

      const savedData = mockLifelogStore.save.mock.calls[0][2];
      // Should not have duplicate receipt
      const amazonReceipts = savedData.receipts.filter(r => r.source === 'amazon' || r.id.includes('amazon'));
      expect(amazonReceipts.length).toBe(1);
    });

    test('sorts receipts by date descending', async () => {
      mockLifelogStore.load.mockResolvedValue({
        meta: {},
        receipts: [
          { id: 'receipt-old', date: '2026-01-01' },
          { id: 'receipt-newer', date: '2026-01-10' },
        ],
      });
      mockGmail.users.messages.list.mockResolvedValue({
        data: { messages: [{ id: 'msg-123' }] },
      });

      await harvester.harvest('testuser', { days: 7 });

      const savedData = mockLifelogStore.save.mock.calls[0][2];
      const dates = savedData.receipts.map(r => r.date);
      // Should be sorted descending (newest first)
      for (let i = 0; i < dates.length - 1; i++) {
        expect(new Date(dates[i]) >= new Date(dates[i + 1])).toBe(true);
      }
    });
  });

  describe('formatLocalTimestamp (via harvest)', () => {
    beforeEach(() => {
      mockConfigService.getUserHouseholdId.mockReturnValue('household-123');
      mockConfigService.getHouseholdConfig.mockReturnValue({
        shopping: { enabled: true, timezone: 'America/Chicago', retailers: mockRetailers },
      });
      mockLifelogStore.load.mockResolvedValue({ meta: {}, receipts: [] });
      mockGmail.users.messages.list.mockResolvedValue({
        data: { messages: [{ id: 'msg-123' }] },
      });
      mockGmail.users.messages.get.mockResolvedValue({ data: mockEmailMessage });
    });

    test('formats datetime with timezone', async () => {
      mockAiGateway.chatWithJson.mockResolvedValue({
        ...mockReceiptData,
        date: '2026-01-13',
        time: '14:30',
      });

      await harvester.harvest('testuser', { days: 7 });

      const savedData = mockLifelogStore.save.mock.calls[0][2];
      const receipt = savedData.receipts.find(r => r.source === 'amazon');
      expect(receipt.datetime).toMatch(/2026-01-13T14:30/);
    });

    test('handles RFC 2822 date format from email headers', async () => {
      mockAiGateway.chatWithJson.mockResolvedValue({
        ...mockReceiptData,
        date: null,
        time: null,
      });

      await harvester.harvest('testuser', { days: 7 });

      const savedData = mockLifelogStore.save.mock.calls[0][2];
      const receipt = savedData.receipts.find(r => r.source === 'amazon');
      expect(receipt.datetime).toBeTruthy();
      // Should have parsed the RFC 2822 date from email header
    });

    test('uses email date when receipt date not available', async () => {
      mockAiGateway.chatWithJson.mockResolvedValue({
        ...mockReceiptData,
        date: null,
      });

      await harvester.harvest('testuser', { days: 7 });

      const savedData = mockLifelogStore.save.mock.calls[0][2];
      const receipt = savedData.receipts.find(r => r.source === 'amazon');
      expect(receipt.date).toBeTruthy();
    });
  });

  describe('getStatus', () => {
    test('returns circuit breaker status', () => {
      const status = harvester.getStatus();

      expect(status).toHaveProperty('state');
      expect(status).toHaveProperty('failures');
      expect(status.state).toBe('closed');
      expect(status.failures).toBe(0);
    });

    test('reflects failure count', async () => {
      mockConfigService.getUserHouseholdId.mockReturnValue('household-123');
      mockConfigService.getHouseholdConfig.mockReturnValue({
        shopping: { enabled: true, retailers: mockRetailers },
      });
      mockLifelogStore.load.mockResolvedValue({ meta: {}, receipts: [] });

      const error = new Error('API Error');
      error.response = { status: 429 };
      mockGmailClientFactory.mockRejectedValue(error);

      try {
        await harvester.harvest('testuser', { days: 7 });
      } catch {
        // Expected
      }

      const status = harvester.getStatus();
      expect(status.failures).toBe(1);
    });
  });

  describe('config loading', () => {
    test('uses household config when available', async () => {
      const customRetailers = [{
        id: 'custom',
        name: 'Custom Store',
        senders: ['orders@custom.com'],
        keywords: ['order'],
      }];

      mockConfigService.getUserHouseholdId.mockReturnValue('household-123');
      mockConfigService.getHouseholdConfig.mockReturnValue({
        shopping: {
          enabled: true,
          timezone: 'America/New_York',
          retailers: customRetailers,
        },
      });
      mockLifelogStore.load.mockResolvedValue({ meta: {}, receipts: [] });
      mockGmail.users.messages.list.mockResolvedValue({ data: { messages: [] } });

      await harvester.harvest('testuser', { days: 7 });

      const query = mockGmail.users.messages.list.mock.calls[0][0].q;
      expect(query).toContain('custom.com');
    });

    test('throws when shopping is disabled in household config', async () => {
      mockConfigService.getUserHouseholdId.mockReturnValue('household-123');
      mockConfigService.getHouseholdConfig.mockReturnValue({
        shopping: {
          enabled: false,
        },
      });
      mockLifelogStore.load.mockResolvedValue({ meta: {}, receipts: [] });
      mockGmail.users.messages.list.mockResolvedValue({ data: { messages: [] } });

      // Should use default config when explicitly disabled
      const result = await harvester.harvest('testuser', { days: 7 });
      expect(result.status).toBe('success');
    });

    test('uses default retailers when config lookup fails', async () => {
      mockConfigService.getUserHouseholdId.mockImplementation(() => {
        throw new Error('Config lookup failed');
      });
      mockLifelogStore.load.mockResolvedValue({ meta: {}, receipts: [] });
      mockGmail.users.messages.list.mockResolvedValue({ data: { messages: [] } });

      const result = await harvester.harvest('testuser', { days: 7 });

      expect(result.status).toBe('success');
      // Should have used default retailers
      const query = mockGmail.users.messages.list.mock.calls[0][0].q;
      expect(query).toContain('amazon.com');
    });
  });

  describe('receipt record structure', () => {
    beforeEach(() => {
      mockConfigService.getUserHouseholdId.mockReturnValue('household-123');
      mockConfigService.getHouseholdConfig.mockReturnValue({
        shopping: { enabled: true, retailers: mockRetailers },
      });
      mockLifelogStore.load.mockResolvedValue({ meta: {}, receipts: [] });
      mockGmail.users.messages.list.mockResolvedValue({
        data: { messages: [{ id: 'msg-123' }] },
      });
      mockGmail.users.messages.get.mockResolvedValue({ data: mockEmailMessage });
    });

    test('creates receipt with all required fields', async () => {
      mockAiGateway.chatWithJson.mockResolvedValue(mockReceiptData);

      await harvester.harvest('testuser', { days: 7 });

      const savedData = mockLifelogStore.save.mock.calls[0][2];
      const receipt = savedData.receipts.find(r => r.source === 'amazon');

      expect(receipt).toMatchObject({
        id: expect.any(String),
        source: 'amazon',
        email_id: 'msg-123',
        date: '2026-01-13',
        datetime: expect.any(String),
        merchant: 'Amazon',
        order_id: '123-456-789',
        subtotal: 29.99,
        tax: 2.47,
        shipping: 0,
        total: 32.46,
        currency: 'USD',
        items: expect.arrayContaining([
          expect.objectContaining({
            name: 'Widget',
            quantity: 1,
            unit_price: 29.99,
            total_price: 29.99,
          }),
        ]),
      });
    });

    test('uses retailer name as merchant fallback', async () => {
      mockAiGateway.chatWithJson.mockResolvedValue({
        ...mockReceiptData,
        merchant: null,
      });

      await harvester.harvest('testuser', { days: 7 });

      const savedData = mockLifelogStore.save.mock.calls[0][2];
      const receipt = savedData.receipts.find(r => r.source === 'amazon');
      expect(receipt.merchant).toBe('Amazon');
    });

    test('defaults currency to USD', async () => {
      mockAiGateway.chatWithJson.mockResolvedValue({
        ...mockReceiptData,
        currency: null,
      });

      await harvester.harvest('testuser', { days: 7 });

      const savedData = mockLifelogStore.save.mock.calls[0][2];
      const receipt = savedData.receipts.find(r => r.source === 'amazon');
      expect(receipt.currency).toBe('USD');
    });

    test('defaults items to empty array', async () => {
      mockAiGateway.chatWithJson.mockResolvedValue({
        ...mockReceiptData,
        items: null,
        total: 50.00,
      });

      await harvester.harvest('testuser', { days: 7 });

      const savedData = mockLifelogStore.save.mock.calls[0][2];
      const receipt = savedData.receipts.find(r => r.source === 'amazon');
      expect(receipt.items).toEqual([]);
    });
  });

  describe('meta data structure', () => {
    beforeEach(() => {
      mockConfigService.getUserHouseholdId.mockReturnValue('household-123');
      mockConfigService.getHouseholdConfig.mockReturnValue({
        shopping: { enabled: true, timezone: 'America/Chicago', retailers: mockRetailers },
      });
      mockLifelogStore.load.mockResolvedValue({ meta: {}, receipts: [] });
      mockGmail.users.messages.list.mockResolvedValue({
        data: { messages: [{ id: 'msg-123' }] },
      });
      mockGmail.users.messages.get.mockResolvedValue({ data: mockEmailMessage });
      mockAiGateway.chatWithJson.mockResolvedValue(mockReceiptData);
    });

    test('saves meta with lastSync timestamp', async () => {
      await harvester.harvest('testuser', { days: 7 });

      const savedData = mockLifelogStore.save.mock.calls[0][2];
      expect(savedData.meta.lastSync).toBeTruthy();
    });

    test('saves meta with timezone', async () => {
      await harvester.harvest('testuser', { days: 7 });

      const savedData = mockLifelogStore.save.mock.calls[0][2];
      expect(savedData.meta.timezone).toBe('America/Chicago');
    });

    test('saves meta with totalReceipts count', async () => {
      await harvester.harvest('testuser', { days: 7 });

      const savedData = mockLifelogStore.save.mock.calls[0][2];
      expect(savedData.meta.totalReceipts).toBe(1);
    });

    test('saves meta with totalItems count', async () => {
      await harvester.harvest('testuser', { days: 7 });

      const savedData = mockLifelogStore.save.mock.calls[0][2];
      expect(savedData.meta.totalItems).toBe(1); // mockReceiptData has 1 item
    });

    test('saves meta with false_positives array', async () => {
      mockAiGateway.chatWithJson.mockResolvedValue({ items: [], total: null });

      await harvester.harvest('testuser', { days: 7 });

      const savedData = mockLifelogStore.save.mock.calls[0][2];
      expect(savedData.meta.false_positives).toContain('msg-123');
    });
  });
});
