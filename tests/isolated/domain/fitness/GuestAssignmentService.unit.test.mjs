// tests/isolated/domain/fitness/GuestAssignmentService.unit.test.mjs
import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// Mock logger
const mockWarn = jest.fn();
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ warn: mockWarn, info: jest.fn(), debug: jest.fn(), error: jest.fn() }),
  getLogger: () => ({ warn: mockWarn, info: jest.fn(), debug: jest.fn(), error: jest.fn() })
}));

describe('GuestAssignmentService', () => {
  let GuestAssignmentService;
  let validateGuestAssignmentPayload;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await import('#frontend/hooks/fitness/GuestAssignmentService.js');
    GuestAssignmentService = module.GuestAssignmentService;
    validateGuestAssignmentPayload = module.validateGuestAssignmentPayload;
  });

  describe('baseUserName preservation', () => {
    test('should preserve baseUserName from assignment payload, not overwrite with guest name', () => {
      // Arrange: Alice owns device, Bob is being assigned as guest
      const mockLedger = {
        get: jest.fn().mockReturnValue(null),
        entries: new Map()
      };
      const mockUserManager = {
        assignGuest: jest.fn()
      };
      const mockSession = {
        userManager: mockUserManager,
        createSessionEntity: jest.fn().mockReturnValue({ entityId: 'entity-123' }),
        eventJournal: { log: jest.fn() }
      };

      const service = new GuestAssignmentService({ session: mockSession, ledger: mockLedger });

      // Act: Assign Bob to Alice's device
      const result = service.assignGuest('device-1', {
        name: 'Bob',
        profileId: 'bob-123',
        baseUserName: 'Alice'  // Alice is the original owner
      });

      // Assert: userManager.assignGuest should receive Alice as baseUserName, NOT Bob
      expect(result.ok).toBe(true);
      expect(mockUserManager.assignGuest).toHaveBeenCalledWith(
        'device-1',
        'Bob',
        expect.objectContaining({
          baseUserName: 'Alice'  // CRITICAL: Must be Alice, not Bob
        })
      );
    });

    test('should preserve baseUserName through chain of guest swaps (A->B->C)', () => {
      // Arrange
      const mockUserManager = { assignGuest: jest.fn() };
      const mockSession = {
        userManager: mockUserManager,
        createSessionEntity: jest.fn().mockReturnValue({ entityId: 'entity-456' }),
        endSessionEntity: jest.fn(),
        eventJournal: { log: jest.fn() }
      };

      // Simulate ledger with Bob currently assigned (baseUserName=Alice)
      const mockLedger = {
        get: jest.fn().mockReturnValue({
          deviceId: 'device-1',
          metadata: { profileId: 'bob-123', baseUserName: 'Alice' },
          occupantId: 'bob-123',
          entityId: 'entity-prev',
          updatedAt: Date.now() - 120000  // 2 min ago (past grace period)
        }),
        entries: new Map()
      };

      const service = new GuestAssignmentService({ session: mockSession, ledger: mockLedger });

      // Act: Assign Carol (third person in chain)
      const result = service.assignGuest('device-1', {
        name: 'Carol',
        profileId: 'carol-789',
        baseUserName: 'Alice'  // Still Alice - the ORIGINAL owner
      });

      // Assert: baseUserName should still be Alice
      expect(result.ok).toBe(true);
      expect(mockUserManager.assignGuest).toHaveBeenCalledWith(
        'device-1',
        'Carol',
        expect.objectContaining({
          baseUserName: 'Alice'  // Must preserve original owner through chain
        })
      );
    });
  });
});
