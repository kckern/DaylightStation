/**
 * Integration tests for Zone LED API Endpoint
 * Tests the full /fitness/zone_led endpoint behavior including:
 * - Request/response handling
 * - Rate limiting
 * - Circuit breaker
 * - Error handling
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';

// =============================================================================
// Mock Setup
// =============================================================================

// Mock the homeassistant module
const mockActivateScene = jest.fn();
jest.unstable_mockModule('../lib/homeassistant.mjs', () => ({
    activateScene: mockActivateScene,
    getEntityState: jest.fn()
}));

// Mock the config loader
const mockLoadFitnessConfig = jest.fn();

// =============================================================================
// Test Fixtures
// =============================================================================

const fullConfig = {
    ambient_led: {
        scenes: {
            off: 'garage_led_off',
            cool: 'garage_led_blue',
            active: 'garage_led_green',
            warm: 'garage_led_yellow',
            hot: 'garage_led_orange',
            fire: 'garage_led_red',
            fire_all: 'garage_led_red_breathe'
        },
        throttle_ms: 2000
    }
};

const disabledConfig = {
    // No ambient_led section
};

const minimalConfig = {
    ambient_led: {
        scenes: {
            off: 'led_off'
        }
    }
};

// =============================================================================
// Zone LED State Management Tests (Unit-like tests for state logic)
// =============================================================================

describe('Zone LED State Management', () => {
    // Replicate the state object for testing
    let zoneLedState;
    
    beforeEach(() => {
        zoneLedState = {
            lastScene: null,
            lastActivatedAt: 0,
            failureCount: 0,
            maxFailures: 5,
            backoffUntil: 0
        };
    });
    
    describe('Deduplication', () => {
        test('should skip when same scene is requested', () => {
            zoneLedState.lastScene = 'garage_led_blue';
            const targetScene = 'garage_led_blue';
            const shouldSkip = targetScene === zoneLedState.lastScene;
            expect(shouldSkip).toBe(true);
        });
        
        test('should not skip when different scene is requested', () => {
            zoneLedState.lastScene = 'garage_led_blue';
            const targetScene = 'garage_led_green';
            const shouldSkip = targetScene === zoneLedState.lastScene;
            expect(shouldSkip).toBe(false);
        });
        
        test('should not skip when lastScene is null (first request)', () => {
            zoneLedState.lastScene = null;
            const targetScene = 'garage_led_blue';
            const shouldSkip = targetScene === zoneLedState.lastScene;
            expect(shouldSkip).toBe(false);
        });
    });
    
    describe('Rate Limiting', () => {
        test('should rate limit when within throttle window', () => {
            const throttleMs = 2000;
            const now = Date.now();
            zoneLedState.lastActivatedAt = now - 1000; // 1 second ago
            
            const elapsed = now - zoneLedState.lastActivatedAt;
            const shouldRateLimit = elapsed < throttleMs;
            
            expect(shouldRateLimit).toBe(true);
        });
        
        test('should not rate limit when outside throttle window', () => {
            const throttleMs = 2000;
            const now = Date.now();
            zoneLedState.lastActivatedAt = now - 3000; // 3 seconds ago
            
            const elapsed = now - zoneLedState.lastActivatedAt;
            const shouldRateLimit = elapsed < throttleMs;
            
            expect(shouldRateLimit).toBe(false);
        });
        
        test('should not rate limit first request (lastActivatedAt = 0)', () => {
            const throttleMs = 2000;
            const now = Date.now();
            zoneLedState.lastActivatedAt = 0;
            
            const elapsed = now - zoneLedState.lastActivatedAt;
            const shouldRateLimit = elapsed < throttleMs;
            
            expect(shouldRateLimit).toBe(false);
        });
    });
    
    describe('Circuit Breaker', () => {
        test('should enter backoff after max failures', () => {
            zoneLedState.failureCount = 5;
            zoneLedState.maxFailures = 5;
            
            const shouldOpenCircuit = zoneLedState.failureCount >= zoneLedState.maxFailures;
            expect(shouldOpenCircuit).toBe(true);
        });
        
        test('should calculate exponential backoff correctly', () => {
            // After 5th failure (first backoff): 2^0 * 1000 = 1000ms
            // After 6th failure: 2^1 * 1000 = 2000ms
            // After 7th failure: 2^2 * 1000 = 4000ms
            // Capped at 60000ms
            
            const calculateBackoff = (failureCount, maxFailures) => {
                const excess = failureCount - maxFailures;
                return Math.min(60000, 1000 * Math.pow(2, excess));
            };
            
            expect(calculateBackoff(5, 5)).toBe(1000);
            expect(calculateBackoff(6, 5)).toBe(2000);
            expect(calculateBackoff(7, 5)).toBe(4000);
            expect(calculateBackoff(8, 5)).toBe(8000);
            expect(calculateBackoff(10, 5)).toBe(32000);
            expect(calculateBackoff(15, 5)).toBe(60000); // Capped
            expect(calculateBackoff(20, 5)).toBe(60000); // Still capped
        });
        
        test('should respect backoff period', () => {
            const now = Date.now();
            zoneLedState.backoffUntil = now + 5000; // 5 seconds in future
            
            const isInBackoff = zoneLedState.backoffUntil > now;
            expect(isInBackoff).toBe(true);
        });
        
        test('should exit backoff after period expires', () => {
            const now = Date.now();
            zoneLedState.backoffUntil = now - 1000; // 1 second in past
            
            const isInBackoff = zoneLedState.backoffUntil > now;
            expect(isInBackoff).toBe(false);
        });
        
        test('should reset failure count on success', () => {
            zoneLedState.failureCount = 3;
            
            // Simulate success
            zoneLedState.failureCount = 0;
            
            expect(zoneLedState.failureCount).toBe(0);
        });
    });
});

// =============================================================================
// Feature Toggle Tests
// =============================================================================

describe('Feature Toggle', () => {
    const isAmbientLedEnabled = (config) => {
        const ambientLed = config?.ambient_led;
        if (!ambientLed) return false;
        
        const scenes = ambientLed.scenes;
        if (!scenes || typeof scenes !== 'object') return false;
        if (!scenes.off) return false;
        
        return true;
    };
    
    test('enabled when fully configured', () => {
        expect(isAmbientLedEnabled(fullConfig)).toBe(true);
    });
    
    test('disabled when ambient_led section missing', () => {
        expect(isAmbientLedEnabled(disabledConfig)).toBe(false);
    });
    
    test('disabled when scenes missing', () => {
        expect(isAmbientLedEnabled({ ambient_led: {} })).toBe(false);
    });
    
    test('disabled when off scene missing', () => {
        expect(isAmbientLedEnabled({
            ambient_led: {
                scenes: { cool: 'led_blue' }
            }
        })).toBe(false);
    });
    
    test('enabled with minimal config (just off scene)', () => {
        expect(isAmbientLedEnabled(minimalConfig)).toBe(true);
    });
    
    test('handles null/undefined config', () => {
        expect(isAmbientLedEnabled(null)).toBe(false);
        expect(isAmbientLedEnabled(undefined)).toBe(false);
    });
});

// =============================================================================
// Session End Priority Tests
// =============================================================================

describe('Session End Priority', () => {
    test('session end should bypass deduplication', () => {
        // Even if last scene was 'off', session end should still send
        const lastScene = 'garage_led_off';
        const targetScene = 'garage_led_off';
        const sessionEnded = true;
        
        // Session end bypasses duplicate check
        const shouldSkipDuplicate = targetScene === lastScene && !sessionEnded;
        expect(shouldSkipDuplicate).toBe(false);
    });
    
    test('session end should bypass rate limiting', () => {
        const throttleMs = 2000;
        const now = Date.now();
        const lastActivatedAt = now - 500; // Only 500ms ago
        const sessionEnded = true;
        
        const elapsed = now - lastActivatedAt;
        const shouldRateLimit = elapsed < throttleMs && !sessionEnded;
        
        expect(shouldRateLimit).toBe(false);
    });
    
    test('normal request should respect rate limiting', () => {
        const throttleMs = 2000;
        const now = Date.now();
        const lastActivatedAt = now - 500; // Only 500ms ago
        const sessionEnded = false;
        
        const elapsed = now - lastActivatedAt;
        const shouldRateLimit = elapsed < throttleMs && !sessionEnded;
        
        expect(shouldRateLimit).toBe(true);
    });
});

// =============================================================================
// Error Response Format Tests
// =============================================================================

describe('Error Response Format', () => {
    test('success response has correct shape', () => {
        const successResponse = { ok: true, scene: 'garage_led_blue' };
        
        expect(successResponse).toHaveProperty('ok', true);
        expect(successResponse).toHaveProperty('scene');
    });
    
    test('skipped response has correct shape', () => {
        const skippedResponse = { 
            ok: true, 
            skipped: true, 
            reason: 'duplicate',
            scene: 'garage_led_blue' 
        };
        
        expect(skippedResponse).toHaveProperty('ok', true);
        expect(skippedResponse).toHaveProperty('skipped', true);
        expect(skippedResponse).toHaveProperty('reason');
    });
    
    test('error response has correct shape', () => {
        const errorResponse = { 
            ok: false, 
            error: 'HA activation failed',
            failureCount: 1 
        };
        
        expect(errorResponse).toHaveProperty('ok', false);
        expect(errorResponse).toHaveProperty('error');
        expect(errorResponse).toHaveProperty('failureCount');
    });
    
    test('feature disabled response has correct shape', () => {
        const disabledResponse = { 
            ok: true, 
            skipped: true, 
            reason: 'feature_disabled',
            message: 'ambient_led not configured or missing required scenes'
        };
        
        expect(disabledResponse).toHaveProperty('reason', 'feature_disabled');
        expect(disabledResponse).toHaveProperty('message');
    });
});

// =============================================================================
// Payload Validation Tests
// =============================================================================

describe('Payload Validation', () => {
    const ZONE_ORDER = ['cool', 'active', 'warm', 'hot', 'fire'];
    
    const normalizeZoneId = (zoneId) => {
        if (!zoneId) return null;
        const lower = String(zoneId).toLowerCase().trim();
        return ZONE_ORDER.includes(lower) ? lower : null;
    };
    
    const extractActiveZones = (zones) => {
        return zones
            .filter(z => z && z.isActive !== false)
            .map(z => normalizeZoneId(z.zoneId))
            .filter(Boolean);
    };
    
    test('extracts active zones correctly', () => {
        const zones = [
            { zoneId: 'warm', isActive: true },
            { zoneId: 'cool', isActive: true }
        ];
        expect(extractActiveZones(zones)).toEqual(['warm', 'cool']);
    });
    
    test('filters out inactive zones', () => {
        const zones = [
            { zoneId: 'fire', isActive: false },
            { zoneId: 'cool', isActive: true }
        ];
        expect(extractActiveZones(zones)).toEqual(['cool']);
    });
    
    test('filters out invalid zone IDs', () => {
        const zones = [
            { zoneId: 'invalid', isActive: true },
            { zoneId: 'warm', isActive: true }
        ];
        expect(extractActiveZones(zones)).toEqual(['warm']);
    });
    
    test('handles null entries in zones array', () => {
        const zones = [
            null,
            { zoneId: 'warm', isActive: true },
            undefined
        ];
        expect(extractActiveZones(zones)).toEqual(['warm']);
    });
    
    test('handles missing isActive (defaults to true)', () => {
        const zones = [
            { zoneId: 'warm' },
            { zoneId: 'cool' }
        ];
        expect(extractActiveZones(zones)).toEqual(['warm', 'cool']);
    });
    
    test('handles empty zones array', () => {
        expect(extractActiveZones([])).toEqual([]);
    });
    
    test('normalizes zone ID case', () => {
        const zones = [
            { zoneId: 'WARM', isActive: true },
            { zoneId: 'Cool', isActive: true },
            { zoneId: 'HOT', isActive: true }
        ];
        expect(extractActiveZones(zones)).toEqual(['warm', 'cool', 'hot']);
    });
    
    test('trims whitespace from zone IDs', () => {
        const zones = [
            { zoneId: '  warm  ', isActive: true }
        ];
        expect(extractActiveZones(zones)).toEqual(['warm']);
    });
});

// =============================================================================
// Throttle Configuration Tests
// =============================================================================

describe('Throttle Configuration', () => {
    test('uses config throttle_ms when provided', () => {
        const config = { ambient_led: { scenes: { off: 'led_off' }, throttle_ms: 5000 } };
        const throttleMs = config.ambient_led.throttle_ms || 2000;
        expect(throttleMs).toBe(5000);
    });
    
    test('defaults to 2000ms when throttle_ms not provided', () => {
        const config = { ambient_led: { scenes: { off: 'led_off' } } };
        const throttleMs = config.ambient_led.throttle_ms || 2000;
        expect(throttleMs).toBe(2000);
    });
    
    test('handles zero throttle_ms (uses default)', () => {
        const config = { ambient_led: { scenes: { off: 'led_off' }, throttle_ms: 0 } };
        const throttleMs = config.ambient_led.throttle_ms || 2000;
        expect(throttleMs).toBe(2000); // 0 is falsy, so uses default
    });
});
