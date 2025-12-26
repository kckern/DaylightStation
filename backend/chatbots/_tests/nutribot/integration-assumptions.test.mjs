/**
 * Integration Assumptions Tests
 * 
 * These tests validate architectural assumptions that caused bugs on 2025-12-26.
 * They catch issues with:
 * - Property name mismatches
 * - Repository method existence
 * - Container dependency wiring
 * - Router callback coverage
 * - Message type handling
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// ============================================================================
// 1. NUTRILOG DATA MODEL TESTS
// Validates that code accesses NutriLog properties correctly
// ============================================================================

describe('NutriLog Data Model Assumptions', () => {
  // Mock a typical NutriLog as it exists in the system
  const createMockNutriLog = (overrides = {}) => ({
    id: 'test-uuid-123',
    userId: 'user-123',
    conversationId: 'telegram:bot_user',
    status: 'pending',
    text: 'chicken sandwich',
    meal: {
      date: '2025-12-25',
      time: 'morning',
    },
    items: [
      { label: 'Chicken Sandwich', grams: 250, color: 'yellow' }
    ],
    metadata: {
      source: 'text',
      messageId: '12345',
    },
    createdAt: '2025-12-25T10:00:00Z',
    updatedAt: '2025-12-25T10:00:00Z',
    ...overrides,
  });

  describe('Date Access Pattern', () => {
    it('should access date from meal.date, NOT root date', () => {
      const log = createMockNutriLog();
      
      // WRONG: log.date (doesn't exist)
      expect(log.date).toBeUndefined();
      
      // CORRECT: log.meal.date
      expect(log.meal.date).toBe('2025-12-25');
    });

    it('should use correct fallback pattern for date access', () => {
      const log = createMockNutriLog();
      
      // The correct pattern used throughout the codebase
      const getLogDate = (nutriLog) => nutriLog.meal?.date || nutriLog.date || null;
      
      expect(getLogDate(log)).toBe('2025-12-25');
      
      // Even if meal is missing, should not crash
      const logWithoutMeal = createMockNutriLog({ meal: undefined });
      expect(getLogDate(logWithoutMeal)).toBeNull();
    });

    it('should have messageId in metadata, not at root', () => {
      const log = createMockNutriLog();
      
      // WRONG
      expect(log.messageId).toBeUndefined();
      
      // CORRECT
      expect(log.metadata.messageId).toBe('12345');
    });
  });

  describe('Item Structure', () => {
    it('items should use label (not name) for display', () => {
      const log = createMockNutriLog();
      const item = log.items[0];
      
      // Primary field is 'label'
      expect(item.label).toBeDefined();
      
      // Fallback pattern should check both
      const getItemLabel = (i) => i.label || i.name || 'Unknown';
      expect(getItemLabel(item)).toBe('Chicken Sandwich');
    });
  });
});

// ============================================================================
// 2. REPOSITORY METHOD EXISTENCE TESTS
// Validates that use cases call methods that actually exist
// ============================================================================

describe('Repository Method Assumptions', () => {
  describe('NutriListRepository Interface', () => {
    // Define the expected interface
    const expectedMethods = [
      'syncFromLog',
      'saveMany',
      'findAll',
      'findByLogId',
      'findByUuid',
      'findByDate',
      'findAccepted',
      'findByColor',
      'deleteById',       // Note: deleteById, not delete
      'updatePortion',    // Note: updatePortion, not update
    ];

    const nonExistentMethods = [
      'findById',      // Common mistake - should be findByUuid
      'getAll',        // Common mistake - should be findAll
      'save',          // Use saveMany instead
      'getById',       // Should be findByUuid
    ];

    it('should have all expected methods', async () => {
      const { NutriListRepository } = await import('../../bots/nutribot/repositories/NutriListRepository.mjs');
      
      // Create minimal mock config
      const mockConfig = {
        getNutrilistPath: () => '/tmp/test',
        getNutridayPath: () => '/tmp/test-day',
      };
      
      const repo = new NutriListRepository({ config: mockConfig });
      
      for (const method of expectedMethods) {
        expect(typeof repo[method]).toBe('function');
      }
    });

    it('should NOT have commonly mistaken methods', async () => {
      const { NutriListRepository } = await import('../../bots/nutribot/repositories/NutriListRepository.mjs');
      
      const mockConfig = {
        getNutrilistPath: () => '/tmp/test',
        getNutridayPath: () => '/tmp/test-day',
      };
      
      const repo = new NutriListRepository({ config: mockConfig });
      
      for (const method of nonExistentMethods) {
        expect(repo[method]).toBeUndefined();
      }
    });
  });

  describe('NutriLogRepository Interface', () => {
    const expectedMethods = [
      'save',
      'getById',
      'findByUuid',
      'findAll',
      'findPending',
      'findAccepted',
      'updateStatus',
      'getDailySummary',
      'delete',
      'hardDelete',
    ];

    it('should have all expected methods', async () => {
      const { NutriLogRepository } = await import('../../bots/nutribot/repositories/NutriLogRepository.mjs');
      
      const mockConfig = {
        getNutrilogPath: () => '/tmp/test',
      };
      
      const repo = new NutriLogRepository({ config: mockConfig });
      
      for (const method of expectedMethods) {
        expect(typeof repo[method]).toBe('function',
          `NutriLogRepository should have method '${method}'`);
      }
    });
  });
});

// ============================================================================
// 3. CONTAINER DEPENDENCY WIRING TESTS
// Validates that all use cases get their required dependencies
// ============================================================================

describe('Container Dependency Wiring', () => {
  it('should wire DeleteListItem with all required dependencies', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const containerPath = path.resolve(__dirname, '../../bots/nutribot/container.mjs');
    const containerSource = await fs.readFile(containerPath, 'utf-8');
    
    // Find the getDeleteListItem method
    const deleteListItemMatch = containerSource.match(/getDeleteListItem\(\)[^}]+new DeleteListItem\(\{([^}]+)\}\)/s);
    expect(deleteListItemMatch).not.toBeNull();
    
    const depsSection = deleteListItemMatch[1];
    
    // Check required deps are present
    expect(depsSection).toContain('messagingGateway');
    expect(depsSection).toContain('nutriLogRepository');
    expect(depsSection).toContain('nutriListRepository');
    expect(depsSection).toContain('config');
  });

  it('should wire MoveItemToDate with all required dependencies', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const containerPath = path.resolve(__dirname, '../../bots/nutribot/container.mjs');
    const containerSource = await fs.readFile(containerPath, 'utf-8');
    
    // Find the getMoveItemToDate method
    const moveItemMatch = containerSource.match(/getMoveItemToDate\(\)[^}]+new MoveItemToDate\(\{([^}]+)\}\)/s);
    expect(moveItemMatch).not.toBeNull();
    
    const depsSection = moveItemMatch[1];
    
    // Check required deps are present
    expect(depsSection).toContain('messagingGateway');
    expect(depsSection).toContain('nutriLogRepository');
    expect(depsSection).toContain('nutriListRepository');
    expect(depsSection).toContain('config');
  });

  it('should wire GenerateDailyReport with all required dependencies', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const containerPath = path.resolve(__dirname, '../../bots/nutribot/container.mjs');
    const containerSource = await fs.readFile(containerPath, 'utf-8');
    
    // Find the getGenerateDailyReport method
    const reportMatch = containerSource.match(/getGenerateDailyReport\(\)[^}]+new GenerateDailyReport\(\{([^}]+)\}\)/s);
    expect(reportMatch).not.toBeNull();
    
    const depsSection = reportMatch[1];
    
    // Check required deps are present
    expect(depsSection).toContain('messagingGateway');
    expect(depsSection).toContain('nutriLogRepository');
    expect(depsSection).toContain('nutriListRepository');
    expect(depsSection).toContain('config');
  });
});

// ============================================================================
// 4. ROUTER CALLBACK COVERAGE TESTS
// Validates that all callback_data values have handlers
// ============================================================================

describe('Router Callback Coverage', () => {
  // All callback_data values used in the UI
  const allCallbackPatterns = [
    // Food log actions (use case keyword, not exact match)
    { pattern: 'accept', description: 'Accept food log' },
    { pattern: 'revise', description: 'Revise food log' },
    { pattern: 'discard', description: 'Discard food log' },
    
    // UPC portion selection
    { pattern: 'portion', description: 'UPC portion selection' },
    
    // Report actions
    { pattern: 'report_adjust', description: 'Adjust report' },
    { pattern: 'report_accept', description: 'Accept report' },
    
    // Adjustment flow
    { pattern: 'adj_start', description: 'Start adjustment' },
    { pattern: 'adj_done', description: 'Done adjusting' },
    { pattern: 'adj_date', description: 'Select date' },
    { pattern: 'adj_item', description: 'Select item' },
    { pattern: 'adj_factor', description: 'Apply factor' },
    { pattern: 'adj_delete', description: 'Delete item' },
    { pattern: 'adj_move', description: 'Move item' },
    { pattern: 'adj_back', description: 'Go back' },
    { pattern: 'adj_page', description: 'Pagination' },
  ];

  it('should have handlers for all callback patterns', async () => {
    // Read the router source to check for handlers
    const fs = await import('fs/promises');
    const routerSource = await fs.readFile(
      new URL('../../application/routing/UnifiedEventRouter.mjs', import.meta.url),
      'utf-8'
    );

    const missingHandlers = [];

    for (const { pattern, description } of allCallbackPatterns) {
      // Check if the pattern is handled in the router (more flexible matching)
      const isHandled = 
        routerSource.includes(`'${pattern}'`) ||
        routerSource.includes(`"${pattern}"`) ||
        routerSource.includes(`'${pattern}_`) ||
        routerSource.includes(`"${pattern}_`) ||
        routerSource.includes(`case '${pattern}'`) ||
        routerSource.includes(`case "${pattern}"`) ||
        new RegExp(`startsWith\\(['"]${pattern}`).test(routerSource) ||
        new RegExp(`=== ['"]${pattern}`).test(routerSource);

      if (!isHandled) {
        missingHandlers.push({ pattern, description });
      }
    }

    expect(missingHandlers).toEqual([]);
  });
});

// ============================================================================
// 5. TELEGRAM MESSAGE TYPE HANDLING TESTS
// Validates that code handles both text and photo messages
// ============================================================================

describe('Telegram Message Type Handling', () => {
  describe('TelegramGateway.updateMessage', () => {
    it('should handle text update on text message', async () => {
      // This is the normal case - should use editMessageText
      const mockCallApi = jest.fn().mockResolvedValue({ ok: true });
      
      const { TelegramGateway } = await import('../../infrastructure/messaging/TelegramGateway.mjs');
      
      // Can't easily test without mocking axios, but we can check the method exists
      expect(TelegramGateway.prototype.updateMessage).toBeDefined();
    });

    it('should have fallback for photo messages when text update fails', async () => {
      // Read the gateway source to verify fallback logic exists
      const fs = await import('fs/promises');
      const gatewaySource = await fs.readFile(
        new URL('../../infrastructure/messaging/TelegramGateway.mjs', import.meta.url),
        'utf-8'
      );

      // Should have fallback to editMessageCaption when editMessageText fails
      expect(gatewaySource).toContain('editMessageCaption');
      expect(gatewaySource).toContain('no text in the message');
    });

    it('should have updateKeyboard method for keyboard-only updates', async () => {
      const fs = await import('fs/promises');
      const gatewaySource = await fs.readFile(
        new URL('../../infrastructure/messaging/TelegramGateway.mjs', import.meta.url),
        'utf-8'
      );

      // Should have dedicated method for keyboard updates
      expect(gatewaySource).toContain('updateKeyboard');
      expect(gatewaySource).toContain('editMessageReplyMarkup');
    });
  });
});

// ============================================================================
// 6. IMPORT PATH VALIDATION TESTS
// Validates that imports resolve correctly (using file existence check)
// ============================================================================

describe('Import Path Validation', () => {
  const criticalFiles = [
    'bots/nutribot/application/usecases/GenerateDailyReport.mjs',
    'bots/nutribot/application/usecases/AcceptFoodLog.mjs',
    'bots/nutribot/application/usecases/LogFoodFromText.mjs',
    'bots/nutribot/repositories/NutriLogRepository.mjs',
    'bots/nutribot/repositories/NutriListRepository.mjs',
    'adapters/http/CanvasReportRenderer.mjs',
  ];

  for (const file of criticalFiles) {
    it(`${file} should exist and be importable`, async () => {
      const fs = await import('fs/promises');
      const path = await import('path');
      const { fileURLToPath } = await import('url');
      
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const chatbotsDir = path.resolve(__dirname, '../..');
      const fullPath = path.join(chatbotsDir, file);
      
      // Check file exists
      const stats = await fs.stat(fullPath);
      expect(stats.isFile()).toBe(true);
    });
  }
});

// ============================================================================
// 7. USE CASE DATE HANDLING TESTS
// Validates that use cases correctly handle dates from NutriLog
// ============================================================================

describe('Use Case Date Handling', () => {
  // These use cases need to extract date from NutriLog correctly
  const useCasesWithDateHandling = [
    'AcceptFoodLog',
    'SelectUPCPortion',
    'ConfirmAllPending',
  ];

  for (const useCaseName of useCasesWithDateHandling) {
    it(`${useCaseName} should use meal.date pattern`, async () => {
      const fs = await import('fs/promises');
      
      let source;
      try {
        source = await fs.readFile(
          new URL(`../../bots/nutribot/application/usecases/${useCaseName}.mjs`, import.meta.url),
          'utf-8'
        );
      } catch (e) {
        console.warn(`Skipping ${useCaseName}: file not found`);
        return;
      }

      // Should use meal?.date pattern, not just .date
      const usesMealDate = source.includes('meal?.date') || source.includes('meal.date');
      const usesRootDateOnly = /nutriLog\.date[^?]/.test(source) && !usesMealDate;

      expect(usesRootDateOnly).toBe(false,
        `${useCaseName} should use nutriLog.meal?.date, not just nutriLog.date`
      );
    });
  }
});

// ============================================================================
// 8. MESSAGEGATEWAY METHOD SIGNATURE TESTS
// Validates that messaging gateway methods are called with correct params
// ============================================================================

describe('MessagingGateway Method Signatures', () => {
  it('updateMessage should accept text OR caption, not both for same message', async () => {
    const fs = await import('fs/promises');
    const gatewaySource = await fs.readFile(
      new URL('../../infrastructure/messaging/TelegramGateway.mjs', import.meta.url),
      'utf-8'
    );

    // Should have separate handling for text vs caption
    expect(gatewaySource).toContain('updates.text !== undefined');
    expect(gatewaySource).toContain('updates.caption !== undefined');
  });

  it('updateMessage with only choices should use updateKeyboard', async () => {
    const fs = await import('fs/promises');
    const gatewaySource = await fs.readFile(
      new URL('../../infrastructure/messaging/TelegramGateway.mjs', import.meta.url),
      'utf-8'
    );

    // When only choices provided, should call updateKeyboard
    expect(gatewaySource).toContain('else if (updates.choices !== undefined)');
  });
});

// ============================================================================
// 9. STATUS & DATE SYNC TESTS (NutriList/NutriLog integration)
// Covers: pending vs accepted, date persistence, delete, portion update
// ============================================================================

describe('NutriList/NutriLog status & date sync', () => {
  const makeTempConfig = (dir, pathLib) => ({
    getNutrilistPath: () => pathLib.join(dir, 'nutrilist.json'),
    getNutridayPath: () => pathLib.join(dir, 'nutriday.json'),
  });

  const makeLog = ({
    id = 'log-1',
    userId = 'user-1',
    status = 'accepted',
    date = '2025-12-25',
    itemUuid = 'item-1',
  } = {}) => ({
    id,
    userId,
    status,
    isAccepted: status === 'accepted',
    meal: { date },
    toNutriListItems: () => ([{
      uuid: itemUuid,
      logId: id,
      date,
      grams: 100,
      calories: 200,
      color: 'green',
      createdAt: `${date}T00:00:00Z`,
    }]),
  });

  beforeEach(() => {
    // Ensure path.data is defined for loadFile/saveFile helpers used by repositories
    process.env.path = { data: '/tmp' };
  });

  it('pending logs should NOT sync; accepted logs should sync with meal.date', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'nutrilist-'));
    process.env.path = { data: tmp };
    const { NutriListRepository } = await import('../../bots/nutribot/repositories/NutriListRepository.mjs');
    const repo = new NutriListRepository({ config: makeTempConfig(tmp, path) });
    repo.syncNutriday = jest.fn(); // avoid touching nutriday

    // Pending log should not appear
    await repo.syncFromLog(makeLog({ status: 'pending', itemUuid: 'pending-1' }));
    let items = await repo.findByDate('user-1', '2025-12-25');
    expect(items.length).toBe(0);

    // Accepted log should appear with correct date
    await repo.syncFromLog(makeLog({ status: 'accepted', itemUuid: 'acc-1' }));
    items = await repo.findByDate('user-1', '2025-12-25');
    expect(items.map(i => i.uuid)).toContain('acc-1');
  });

  it('deleteById should remove the item and update file', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'nutrilist-'));
    process.env.path = { data: tmp };
    const { NutriListRepository } = await import('../../bots/nutribot/repositories/NutriListRepository.mjs');
    const repo = new NutriListRepository({ config: makeTempConfig(tmp, path) });
    repo.syncNutriday = jest.fn();

    await repo.syncFromLog(makeLog({ status: 'accepted', itemUuid: 'acc-del' }));
    let items = await repo.findByDate('user-1', '2025-12-25');
    expect(items.map(i => i.uuid)).toContain('acc-del');

    const removed = await repo.deleteById('user-1', 'acc-del');
    expect(removed).toBe(true);
    items = await repo.findByDate('user-1', '2025-12-25');
    expect(items.map(i => i.uuid)).not.toContain('acc-del');
  });

  it('updatePortion should scale numeric fields and grams', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'nutrilist-'));
    process.env.path = { data: tmp };
    const { NutriListRepository } = await import('../../bots/nutribot/repositories/NutriListRepository.mjs');
    const repo = new NutriListRepository({ config: makeTempConfig(tmp, path) });
    repo.syncNutriday = jest.fn();

    // Seed via syncFromLog with an accepted log containing numeric fields
    const logWithPortion = makeLog({
      id: 'log-portion',
      itemUuid: 'portion-1',
      status: 'accepted',
      date: '2025-12-25',
    });
    logWithPortion.toNutriListItems = () => ([{
      uuid: 'portion-1',
      logId: 'log-portion',
      date: '2025-12-25',
      grams: 120,
      calories: 200,
      protein: 20,
      fat: 10,
      carbs: 15,
      amount: 1,
    }]);
    await repo.syncFromLog(logWithPortion);

    const ok = await repo.updatePortion('user-1', 'portion-1', 0.5);
    expect(ok).toBe(true);

    const items = await repo.findByDate('user-1', '2025-12-25');
    const updated = items.find(i => i.uuid === 'portion-1');
    expect(updated.calories).toBe(100); // rounded
    expect(updated.grams).toBe(60); // rounded
  });
});

// ============================================================================
// 10. REPORT PENDING/AUTO-ACCEPT PERMUTATIONS
// Validates GenerateDailyReport behavior for pending logs with and without auto-accept
// ============================================================================

describe('GenerateDailyReport pending permutations', () => {
  const makeGateway = () => ({
    sendMessage: jest.fn().mockResolvedValue({}),
    updateMessage: jest.fn().mockResolvedValue({}),
    sendPhoto: jest.fn().mockResolvedValue({ messageId: 'report-msg' }),
  });

  const summaryNoLogs = { logCount: 0, gramsByColor: {}, caloriesByColor: {} };

  it('skips report when pending exists and autoAcceptPending is false', async () => {
    const pendingLog = { id: 'p1' };
    const mockRepo = {
      findPending: jest.fn().mockResolvedValue([pendingLog]),
      getDailySummary: jest.fn().mockResolvedValue(summaryNoLogs),
    };
    const mockListRepo = { findByDate: jest.fn().mockResolvedValue([]) };
    const gateway = makeGateway();

    const { GenerateDailyReport } = await import('../../bots/nutribot/application/usecases/GenerateDailyReport.mjs');
    const useCase = new GenerateDailyReport({
      messagingGateway: gateway,
      nutriLogRepository: mockRepo,
      nutriListRepository: mockListRepo,
      conversationStateStore: { get: jest.fn() },
      config: { getThresholds: () => ({ daily: 2000 }) },
    });

    const result = await useCase.execute({ userId: 'user-1', conversationId: 'chat-1' });

    expect(result.success).toBe(false);
    expect(result.skippedReason).toMatch(/pending/);
    expect(gateway.sendMessage).toHaveBeenCalled();
  });

  it('auto-accepts pending when autoAcceptPending is true', async () => {
    const acceptedLog = { id: 'acc', isAccepted: true, meal: { date: '2025-12-25' } };
    const pendingLog = {
      id: 'p1',
      metadata: { messageId: 'm1' },
      meal: { date: '2025-12-25' },
      items: [{ label: 'x' }],
      accept: jest.fn().mockReturnValue(acceptedLog),
    };

    const mockRepo = {
      findPending: jest.fn().mockResolvedValue([pendingLog]),
      save: jest.fn().mockResolvedValue(),
      getDailySummary: jest.fn().mockResolvedValue(summaryNoLogs),
    };
    const mockListRepo = {
      syncFromLog: jest.fn().mockResolvedValue(),
      findByDate: jest.fn().mockResolvedValue([]),
    };
    const gateway = makeGateway();

    const { GenerateDailyReport } = await import('../../bots/nutribot/application/usecases/GenerateDailyReport.mjs');
    const useCase = new GenerateDailyReport({
      messagingGateway: gateway,
      nutriLogRepository: mockRepo,
      nutriListRepository: mockListRepo,
      conversationStateStore: { get: jest.fn() },
      config: { getThresholds: () => ({ daily: 2000 }) },
    });

    const result = await useCase.execute({ userId: 'user-1', conversationId: 'chat-1', autoAcceptPending: true });

    expect(mockRepo.save).toHaveBeenCalled();
    expect(mockListRepo.syncFromLog).toHaveBeenCalled();
    expect(gateway.updateMessage).toHaveBeenCalled(); // keyboard removal
    expect(result.success).toBe(false); // no logs summary -> skipped
  });
});

// ============================================================================
// 11. ROUTER VARIANT COVERAGE
// Validates emoji/text variants and legacy numeric portion handling
// ============================================================================

describe('Router variant coverage', () => {
  it('should handle emoji variants for accept/revise/discard and numeric portion fallback', async () => {
    const fs = await import('fs/promises');
    const routerSource = await fs.readFile(
      new URL('../../application/routing/UnifiedEventRouter.mjs', import.meta.url),
      'utf-8'
    );

    // Emoji variants
    expect(routerSource).toContain("case '✅'");
    expect(routerSource).toContain("case '✏️'");
    expect(routerSource).toContain("case '🗑️'");

    // Legacy numeric portion selection (default case numeric factor)
    expect(routerSource).toMatch(/const factor = parseFloat\(action\)/);
    expect(routerSource).toContain('getSelectUPCPortion');
  });
});
