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

  describe('one-device-per-user constraint', () => {
    test('should reject assignment if user is already assigned to another device', () => {
      // Arrange: Bob is already assigned to device-2
      const existingEntries = new Map([
        ['device-2', {
          deviceId: 'device-2',
          metadata: { profileId: 'bob-123' },
          occupantId: 'bob-123'
        }]
      ]);

      const mockLedger = {
        get: jest.fn().mockReturnValue(null),
        entries: existingEntries
      };
      const mockUserManager = { assignGuest: jest.fn() };
      const mockSession = {
        userManager: mockUserManager,
        createSessionEntity: jest.fn(),
        eventJournal: { log: jest.fn() }
      };

      const service = new GuestAssignmentService({ session: mockSession, ledger: mockLedger });

      // Act: Try to assign Bob to device-1 (he's already on device-2)
      const result = service.assignGuest('device-1', {
        name: 'Bob',
        profileId: 'bob-123',
        baseUserName: 'Alice'
      });

      // Assert: Should reject with user-already-assigned error
      expect(result.ok).toBe(false);
      expect(result.code).toBe('user-already-assigned');
      expect(result.message).toContain('device-2');
      expect(mockUserManager.assignGuest).not.toHaveBeenCalled();
    });

    test('should allow assignment if user has allowWhileAssigned flag', () => {
      // Arrange: Generic "Guest" is assigned to device-2 but has allowWhileAssigned
      const existingEntries = new Map([
        ['device-2', {
          deviceId: 'device-2',
          metadata: { profileId: 'guest', allowWhileAssigned: true },
          occupantId: 'guest'
        }]
      ]);

      const mockLedger = {
        get: jest.fn().mockReturnValue(null),
        entries: existingEntries
      };
      const mockUserManager = { assignGuest: jest.fn() };
      const mockSession = {
        userManager: mockUserManager,
        createSessionEntity: jest.fn().mockReturnValue({ entityId: 'entity-new' }),
        eventJournal: { log: jest.fn() }
      };

      const service = new GuestAssignmentService({ session: mockSession, ledger: mockLedger });

      // Act: Assign "Guest" to device-1 (allowWhileAssigned should bypass)
      const result = service.assignGuest('device-1', {
        name: 'Guest',
        profileId: 'guest',
        allowWhileAssigned: true,
        baseUserName: 'Alice'
      });

      // Assert: Should succeed
      expect(result.ok).toBe(true);
      expect(mockUserManager.assignGuest).toHaveBeenCalled();
    });

    test('should allow re-assignment to same device (update scenario)', () => {
      // Arrange: Bob is already on device-1, we're updating his assignment
      const existingEntries = new Map([
        ['device-1', {
          deviceId: 'device-1',
          metadata: { profileId: 'bob-123' },
          occupantId: 'bob-123'
        }]
      ]);

      const mockLedger = {
        get: jest.fn().mockReturnValue(existingEntries.get('device-1')),
        entries: existingEntries
      };
      const mockUserManager = { assignGuest: jest.fn() };
      const mockSession = {
        userManager: mockUserManager,
        createSessionEntity: jest.fn().mockReturnValue({ entityId: 'entity-new' }),
        eventJournal: { log: jest.fn() }
      };

      const service = new GuestAssignmentService({ session: mockSession, ledger: mockLedger });

      // Act: Re-assign Bob to same device (update metadata)
      const result = service.assignGuest('device-1', {
        name: 'Bob',
        profileId: 'bob-123',
        baseUserName: 'Alice'
      });

      // Assert: Should succeed (same device)
      expect(result.ok).toBe(true);
    });
  });
});
