/**
 * Unit tests for Ambient LED Zone Resolution Logic
 * Tests the zone-to-scene mapping and resolution functions
 */

import { describe, test, expect, beforeEach } from '@jest/globals';

// =============================================================================
// Replicated Logic for Testing (mirrors fitness.mjs implementation)
// =============================================================================

const ZONE_PRIORITY = { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 };
const ZONE_ORDER = ['cool', 'active', 'warm', 'hot', 'fire'];

function normalizeZoneId(zoneId) {
    if (!zoneId) return null;
    const lower = String(zoneId).toLowerCase().trim();
    return ZONE_ORDER.includes(lower) ? lower : null;
}

function isAmbientLedEnabled(fitnessConfig) {
    const ambientLed = fitnessConfig?.ambient_led;
    if (!ambientLed) return false;
    
    const scenes = ambientLed.scenes;
    if (!scenes || typeof scenes !== 'object') return false;
    if (!scenes.off) return false;
    
    return true;
}

function resolveSceneFromConfig(sceneConfig, zoneKey) {
    if (!sceneConfig || typeof sceneConfig !== 'object') return null;
    
    if (sceneConfig[zoneKey]) return sceneConfig[zoneKey];
    
    if (zoneKey === 'fire_all') return sceneConfig.fire || sceneConfig.off || null;
    
    const zoneIndex = ZONE_ORDER.indexOf(zoneKey);
    if (zoneIndex > 0) {
        for (let i = zoneIndex - 1; i >= 0; i--) {
            if (sceneConfig[ZONE_ORDER[i]]) return sceneConfig[ZONE_ORDER[i]];
        }
    }
    
    return sceneConfig.off || null;
}

function resolveTargetScene(zones, sessionEnded, sceneConfig) {
    if (!sceneConfig) return null;
    
    if (sessionEnded) return resolveSceneFromConfig(sceneConfig, 'off');
    
    const activeZones = zones
        .filter(z => z && z.isActive !== false)
        .map(z => normalizeZoneId(z.zoneId))
        .filter(Boolean);
    
    if (activeZones.length === 0) return resolveSceneFromConfig(sceneConfig, 'off');
    
    const maxZone = activeZones.reduce((max, zone) =>
        ZONE_PRIORITY[zone] > ZONE_PRIORITY[max] ? zone : max
    , 'cool');
    
    if (maxZone === 'fire' && activeZones.every(z => z === 'fire')) {
        return resolveSceneFromConfig(sceneConfig, 'fire_all');
    }
    
    return resolveSceneFromConfig(sceneConfig, maxZone);
}

// =============================================================================
// Test Fixtures
// =============================================================================

const fullSceneConfig = {
    off: 'garage_led_off',
    cool: 'garage_led_blue',
    active: 'garage_led_green',
    warm: 'garage_led_yellow',
    hot: 'garage_led_orange',
    fire: 'garage_led_red',
    fire_all: 'garage_led_red_breathe'
};

const minimalSceneConfig = {
    off: 'led_off',
    fire: 'led_red'
};

// =============================================================================
// Tests
// =============================================================================

describe('normalizeZoneId', () => {
    test('normalizes valid zone IDs', () => {
        expect(normalizeZoneId('cool')).toBe('cool');
        expect(normalizeZoneId('ACTIVE')).toBe('active');
        expect(normalizeZoneId('  Warm  ')).toBe('warm');
        expect(normalizeZoneId('HOT')).toBe('hot');
        expect(normalizeZoneId('fire')).toBe('fire');
    });
    
    test('returns null for invalid zone IDs', () => {
        expect(normalizeZoneId(null)).toBe(null);
        expect(normalizeZoneId(undefined)).toBe(null);
        expect(normalizeZoneId('')).toBe(null);
        expect(normalizeZoneId('invalid')).toBe(null);
        expect(normalizeZoneId('red')).toBe(null); // color, not zone
        expect(normalizeZoneId(123)).toBe(null);
    });
});

describe('isAmbientLedEnabled', () => {
    test('returns true when properly configured', () => {
        const config = { ambient_led: { scenes: { off: 'led_off' } } };
        expect(isAmbientLedEnabled(config)).toBe(true);
    });
    
    test('returns false when ambient_led section is missing', () => {
        expect(isAmbientLedEnabled({})).toBe(false);
        expect(isAmbientLedEnabled(null)).toBe(false);
        expect(isAmbientLedEnabled(undefined)).toBe(false);
    });
    
    test('returns false when scenes is missing', () => {
        expect(isAmbientLedEnabled({ ambient_led: {} })).toBe(false);
        expect(isAmbientLedEnabled({ ambient_led: { scenes: null } })).toBe(false);
    });
    
    test('returns false when off scene is missing', () => {
        const config = { ambient_led: { scenes: { cool: 'led_blue' } } };
        expect(isAmbientLedEnabled(config)).toBe(false);
    });
});

describe('resolveSceneFromConfig', () => {
    test('returns direct scene match', () => {
        expect(resolveSceneFromConfig(fullSceneConfig, 'cool')).toBe('garage_led_blue');
        expect(resolveSceneFromConfig(fullSceneConfig, 'fire')).toBe('garage_led_red');
    });
    
    test('falls back to lower zone when scene missing', () => {
        const partialConfig = {
            off: 'led_off',
            cool: 'led_blue',
            warm: 'led_yellow'
            // active missing - should fall back to cool
            // hot missing - should fall back to warm
        };
        expect(resolveSceneFromConfig(partialConfig, 'active')).toBe('led_blue');
        expect(resolveSceneFromConfig(partialConfig, 'hot')).toBe('led_yellow');
    });
    
    test('falls back to off when no lower zone available', () => {
        expect(resolveSceneFromConfig(minimalSceneConfig, 'cool')).toBe('led_off');
        expect(resolveSceneFromConfig(minimalSceneConfig, 'warm')).toBe('led_off');
    });
    
    test('fire_all falls back to fire then off', () => {
        expect(resolveSceneFromConfig(fullSceneConfig, 'fire_all')).toBe('garage_led_red_breathe');
        expect(resolveSceneFromConfig(minimalSceneConfig, 'fire_all')).toBe('led_red');
        expect(resolveSceneFromConfig({ off: 'led_off' }, 'fire_all')).toBe('led_off');
    });
    
    test('returns null for invalid config', () => {
        expect(resolveSceneFromConfig(null, 'cool')).toBe(null);
        expect(resolveSceneFromConfig(undefined, 'cool')).toBe(null);
        expect(resolveSceneFromConfig('invalid', 'cool')).toBe(null);
    });
});

describe('resolveTargetScene - Basic Zone Resolution', () => {
    test('resolves cool zone to blue LED', () => {
        const zones = [{ zoneId: 'cool', isActive: true }];
        expect(resolveTargetScene(zones, false, fullSceneConfig)).toBe('garage_led_blue');
    });
    
    test('resolves active zone to green LED', () => {
        const zones = [{ zoneId: 'active', isActive: true }];
        expect(resolveTargetScene(zones, false, fullSceneConfig)).toBe('garage_led_green');
    });
    
    test('resolves warm zone to yellow LED', () => {
        const zones = [{ zoneId: 'warm', isActive: true }];
        expect(resolveTargetScene(zones, false, fullSceneConfig)).toBe('garage_led_yellow');
    });
    
    test('resolves hot zone to orange LED', () => {
        const zones = [{ zoneId: 'hot', isActive: true }];
        expect(resolveTargetScene(zones, false, fullSceneConfig)).toBe('garage_led_orange');
    });
    
    test('resolves single fire zone to breathing red (all-in-fire)', () => {
        // Single user in fire = 100% of users in fire, so triggers fire_all
        const zones = [{ zoneId: 'fire', isActive: true }];
        expect(resolveTargetScene(zones, false, fullSceneConfig)).toBe('garage_led_red_breathe');
    });
});

describe('resolveTargetScene - Max Zone Selection', () => {
    test('selects max zone among multiple users', () => {
        const zones = [
            { zoneId: 'cool', isActive: true },
            { zoneId: 'warm', isActive: true },
            { zoneId: 'active', isActive: true }
        ];
        expect(resolveTargetScene(zones, false, fullSceneConfig)).toBe('garage_led_yellow');
    });
    
    test('mixed zones with fire user triggers red LED', () => {
        const zones = [
            { zoneId: 'fire', isActive: true },
            { zoneId: 'warm', isActive: true }
        ];
        expect(resolveTargetScene(zones, false, fullSceneConfig)).toBe('garage_led_red');
    });
    
    test('mixed zones with hot user triggers orange LED', () => {
        const zones = [
            { zoneId: 'hot', isActive: true },
            { zoneId: 'cool', isActive: true },
            { zoneId: 'active', isActive: true }
        ];
        expect(resolveTargetScene(zones, false, fullSceneConfig)).toBe('garage_led_orange');
    });
});

describe('resolveTargetScene - All Fire Special Case', () => {
    test('all users in fire zone triggers breathing red', () => {
        const zones = [
            { zoneId: 'fire', isActive: true },
            { zoneId: 'fire', isActive: true }
        ];
        expect(resolveTargetScene(zones, false, fullSceneConfig)).toBe('garage_led_red_breathe');
    });
    
    test('single user in fire zone triggers breathing (100% in fire)', () => {
        const zones = [{ zoneId: 'fire', isActive: true }];
        // Single user = all users are in fire
        expect(resolveTargetScene(zones, false, fullSceneConfig)).toBe('garage_led_red_breathe');
    });
    
    test('multiple fire users with one non-fire triggers solid red', () => {
        const zones = [
            { zoneId: 'fire', isActive: true },
            { zoneId: 'fire', isActive: true },
            { zoneId: 'hot', isActive: true }
        ];
        expect(resolveTargetScene(zones, false, fullSceneConfig)).toBe('garage_led_red');
    });
});

describe('resolveTargetScene - Inactive User Handling', () => {
    test('inactive users are excluded from max calculation', () => {
        const zones = [
            { zoneId: 'fire', isActive: false },  // Inactive - should be ignored
            { zoneId: 'cool', isActive: true }
        ];
        expect(resolveTargetScene(zones, false, fullSceneConfig)).toBe('garage_led_blue');
    });
    
    test('all inactive users triggers off scene', () => {
        const zones = [
            { zoneId: 'fire', isActive: false },
            { zoneId: 'hot', isActive: false }
        ];
        expect(resolveTargetScene(zones, false, fullSceneConfig)).toBe('garage_led_off');
    });
    
    test('missing isActive defaults to active', () => {
        const zones = [
            { zoneId: 'warm' }  // No isActive field
        ];
        expect(resolveTargetScene(zones, false, fullSceneConfig)).toBe('garage_led_yellow');
    });
});

describe('resolveTargetScene - Session End', () => {
    test('session ended triggers off regardless of zones', () => {
        const zones = [
            { zoneId: 'fire', isActive: true },
            { zoneId: 'hot', isActive: true }
        ];
        expect(resolveTargetScene(zones, true, fullSceneConfig)).toBe('garage_led_off');
    });
    
    test('session ended with empty zones triggers off', () => {
        expect(resolveTargetScene([], true, fullSceneConfig)).toBe('garage_led_off');
    });
});

describe('resolveTargetScene - Edge Cases', () => {
    test('empty zones array triggers off', () => {
        expect(resolveTargetScene([], false, fullSceneConfig)).toBe('garage_led_off');
    });
    
    test('null/undefined zones in array are ignored', () => {
        const zones = [
            null,
            { zoneId: 'warm', isActive: true },
            undefined,
            { zoneId: null, isActive: true }
        ];
        expect(resolveTargetScene(zones, false, fullSceneConfig)).toBe('garage_led_yellow');
    });
    
    test('invalid zone IDs are ignored', () => {
        const zones = [
            { zoneId: 'invalid', isActive: true },
            { zoneId: 'active', isActive: true }
        ];
        expect(resolveTargetScene(zones, false, fullSceneConfig)).toBe('garage_led_green');
    });
    
    test('returns null when scene config is null', () => {
        const zones = [{ zoneId: 'cool', isActive: true }];
        expect(resolveTargetScene(zones, false, null)).toBe(null);
    });
    
    test('case-insensitive zone matching', () => {
        const zones = [
            { zoneId: 'FIRE', isActive: true },
            { zoneId: 'Fire', isActive: true }
        ];
        expect(resolveTargetScene(zones, false, fullSceneConfig)).toBe('garage_led_red_breathe');
    });
});

describe('resolveTargetScene - Fallback with Minimal Config', () => {
    test('resolves to off when zone scene not configured', () => {
        const zones = [{ zoneId: 'cool', isActive: true }];
        expect(resolveTargetScene(zones, false, minimalSceneConfig)).toBe('led_off');
    });
    
    test('fire zone works with minimal config', () => {
        const zones = [{ zoneId: 'fire', isActive: true }];
        expect(resolveTargetScene(zones, false, minimalSceneConfig)).toBe('led_red');
    });
});
