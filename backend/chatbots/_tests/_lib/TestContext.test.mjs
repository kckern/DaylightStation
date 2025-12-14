/**
 * Tests for TestContext - test data isolation
 * @group testing
 */

import { TestContext, TestScope, createTestHelpers, withTestMode } from '../../_lib/testing/TestContext.mjs';

describe('TestContext', () => {
  // Reset state between tests
  afterEach(() => {
    TestContext.disableTestMode();
    TestContext.clearTrackedPaths();
  });

  describe('enableTestMode / disableTestMode', () => {
    it('should start with test mode disabled', () => {
      expect(TestContext.isTestMode()).toBe(false);
    });

    it('should enable test mode', () => {
      TestContext.enableTestMode();
      expect(TestContext.isTestMode()).toBe(true);
    });

    it('should disable test mode', () => {
      TestContext.enableTestMode();
      TestContext.disableTestMode();
      expect(TestContext.isTestMode()).toBe(false);
    });
  });

  describe('getPrefix', () => {
    it('should return _test prefix', () => {
      expect(TestContext.getPrefix()).toBe('_test');
    });
  });

  describe('transformPath', () => {
    it('should not transform path when test mode disabled', () => {
      const path = 'nutribot/kirk/nutrilog.yml';
      expect(TestContext.transformPath(path)).toBe(path);
    });

    it('should prepend _test/ when test mode enabled', () => {
      TestContext.enableTestMode();
      const path = 'nutribot/kirk/nutrilog.yml';
      expect(TestContext.transformPath(path)).toBe('_test/nutribot/kirk/nutrilog.yml');
    });

    it('should not double-prefix paths', () => {
      TestContext.enableTestMode();
      const path = '_test/nutribot/kirk/nutrilog.yml';
      expect(TestContext.transformPath(path)).toBe('_test/nutribot/kirk/nutrilog.yml');
    });

    it('should track transformed paths', () => {
      TestContext.enableTestMode();
      TestContext.transformPath('nutribot/kirk/nutrilog.yml');
      TestContext.transformPath('nutribot/kirk/nutrilist.yml');
      
      const tracked = TestContext.getTrackedPaths();
      expect(tracked).toContain('_test/nutribot/kirk/nutrilog.yml');
      expect(tracked).toContain('_test/nutribot/kirk/nutrilist.yml');
    });
  });

  describe('trackPath', () => {
    it('should track paths in test mode', () => {
      TestContext.enableTestMode();
      TestContext.trackPath('_test/some/path.yml');
      expect(TestContext.getTrackedPaths()).toContain('_test/some/path.yml');
    });

    it('should not track paths without test prefix', () => {
      TestContext.enableTestMode();
      TestContext.trackPath('some/path.yml');
      expect(TestContext.getTrackedPaths()).not.toContain('some/path.yml');
    });
  });

  describe('clearTrackedPaths', () => {
    it('should clear all tracked paths', () => {
      TestContext.enableTestMode();
      TestContext.transformPath('path1.yml');
      TestContext.transformPath('path2.yml');
      
      TestContext.clearTrackedPaths();
      
      expect(TestContext.getTrackedPaths()).toHaveLength(0);
    });
  });

  describe('cleanup', () => {
    it('should clear tracked paths when no baseDataDir', async () => {
      TestContext.enableTestMode();
      TestContext.transformPath('path.yml');
      
      const result = await TestContext.cleanup();
      
      expect(TestContext.getTrackedPaths()).toHaveLength(0);
      expect(result.deleted).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });
  });
});

describe('TestScope', () => {
  afterEach(() => {
    TestContext.disableTestMode();
    TestContext.clearTrackedPaths();
  });

  it('should enable test mode on setup', () => {
    const scope = TestContext.createScope();
    expect(TestContext.isTestMode()).toBe(false);
    
    scope.setup();
    expect(TestContext.isTestMode()).toBe(true);
  });

  it('should disable test mode on teardown', async () => {
    const scope = TestContext.createScope();
    scope.setup();
    
    await scope.teardown();
    expect(TestContext.isTestMode()).toBe(false);
  });

  it('should restore previous state on teardown', async () => {
    // Start with test mode enabled
    TestContext.enableTestMode();
    
    const scope = TestContext.createScope();
    scope.setup();
    expect(TestContext.isTestMode()).toBe(true);
    
    await scope.teardown();
    // Should still be enabled since it was before
    expect(TestContext.isTestMode()).toBe(true);
  });
});

describe('createTestHelpers', () => {
  afterEach(() => {
    TestContext.disableTestMode();
    TestContext.clearTrackedPaths();
  });

  it('should create beforeEach and afterEach functions', () => {
    const helpers = createTestHelpers();
    
    expect(typeof helpers.beforeEach).toBe('function');
    expect(typeof helpers.afterEach).toBe('function');
  });

  it('beforeEach should enable test mode', () => {
    const helpers = createTestHelpers();
    
    helpers.beforeEach();
    expect(TestContext.isTestMode()).toBe(true);
  });

  it('afterEach should disable test mode', async () => {
    const helpers = createTestHelpers();
    
    helpers.beforeEach();
    await helpers.afterEach();
    expect(TestContext.isTestMode()).toBe(false);
  });
});

describe('withTestMode', () => {
  afterEach(() => {
    TestContext.disableTestMode();
    TestContext.clearTrackedPaths();
  });

  it('should enable test mode during function execution', async () => {
    let wasTestMode = false;
    
    const fn = withTestMode(async () => {
      wasTestMode = TestContext.isTestMode();
    });
    
    await fn();
    
    expect(wasTestMode).toBe(true);
    expect(TestContext.isTestMode()).toBe(false); // Cleaned up after
  });

  it('should pass arguments through', async () => {
    const fn = withTestMode(async (a, b) => {
      return a + b;
    });
    
    const result = await fn(2, 3);
    expect(result).toBe(5);
  });

  it('should cleanup even on error', async () => {
    const fn = withTestMode(async () => {
      throw new Error('test error');
    });
    
    await expect(fn()).rejects.toThrow('test error');
    expect(TestContext.isTestMode()).toBe(false);
  });
});
