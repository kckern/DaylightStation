/**
 * UserService - User Profile and Resolution
 * 
 * Handles:
 * - Loading user profiles from data/users/{id}/profile.yml
 * - Hydrating fitness users (resolving IDs to full profiles)
 * - Platform identity resolution
 */

import { configService } from './index.mjs';
import createLogger from '../logging/logger.js';

const logger = createLogger({ app: 'user_service' });

class UserService {
  #configService = null;

  constructor(cfgService = configService) {
    this.#configService = cfgService;
  }

  /**
   * Get a user profile by username
   * @param {string} username 
   * @returns {object|null}
   */
  getProfile(username) {
    return this.#configService.getUserProfile(username);
  }

  /**
   * Get all user profiles
   * @returns {Map<string, object>}
   */
  getAllProfiles() {
    return this.#configService.getAllUserProfiles();
  }

  /**
   * Hydrate a list of user IDs into full user objects
   * Combines profile data with any inline data provided
   * 
   * @param {Array<string|object>} userList - List of user IDs (strings) or inline objects
   * @param {object} [deviceMappings] - Optional device->user mappings to attach HR device
   * @returns {Array<object>} - Fully hydrated user objects
   */
  hydrateUsers(userList, deviceMappings = {}) {
    if (!Array.isArray(userList)) return [];

    return userList.map(entry => {
      // If it's already a full object (inline definition), return as-is
      if (typeof entry === 'object' && entry !== null) {
        return entry;
      }

      // It's a string ID - load from profile
      const username = String(entry);
      const profile = this.getProfile(username);
      
      if (!profile) {
        // No profile found - return minimal object
        logger.warn('user.profile_not_found', { username });
        return { id: username, name: username };
      }

      // Build hydrated user object
      const hydrated = {
        id: profile.username || username,
        profileId: profile.username || username, // Explicit profile ID for avatar paths
        name: profile.display_name || profile.username || username,
        birthyear: profile.birthyear,
        group_label: profile.group_label,
      };

      console.log('[UserService] Hydrated user:', {
        username,
        'hydrated.id': hydrated.id,
        'hydrated.profileId': hydrated.profileId,
        'hydrated.name': hydrated.name,
        'profile.username': profile.username,
        'profile.display_name': profile.display_name
      });

      // Add fitness-specific data if available
      const fitnessConfig = profile.apps?.fitness;
      if (fitnessConfig) {
        if (fitnessConfig.heart_rate_zones) {
          hydrated.zones = fitnessConfig.heart_rate_zones;
        }
        if (fitnessConfig.max_heart_rate) {
          hydrated.max_heart_rate = fitnessConfig.max_heart_rate;
        }
        if (fitnessConfig.resting_heart_rate) {
          hydrated.resting_heart_rate = fitnessConfig.resting_heart_rate;
        }
      }

      // Attach HR device ID if mapped
      if (deviceMappings.heart_rate) {
        for (const [deviceId, userId] of Object.entries(deviceMappings.heart_rate)) {
          if (userId === username) {
            hydrated.hr = parseInt(deviceId, 10);
            break;
          }
        }
      }

      return hydrated;
    }).filter(Boolean);
  }

  /**
   * Hydrate fitness config - replaces primary user IDs with full profiles
   * While preserving family/friends as inline definitions
   * 
   * @param {object} fitnessConfig - Raw fitness config from data/fitness/config.yaml or household
   * @param {string} [householdId] - Optional household ID (for future household-aware profile resolution)
   * @returns {object} - Hydrated fitness config
   */
  hydrateFitnessConfig(fitnessConfig, householdId = null) {
    if (!fitnessConfig) return fitnessConfig;

    const hydrated = { ...fitnessConfig };
    
    // Get device mappings for HR device attachment
    const deviceMappings = fitnessConfig.devices || {};

    // Hydrate users
    if (fitnessConfig.users) {
      hydrated.users = { ...fitnessConfig.users };

      // Primary users are IDs - hydrate them from profiles
      if (Array.isArray(fitnessConfig.users.primary)) {
        hydrated.users.primary = this.hydrateUsers(
          fitnessConfig.users.primary, 
          deviceMappings
        );
      }

      // Family and friends stay as-is (inline definitions)
      // Just ensure they have consistent structure
      if (Array.isArray(fitnessConfig.users.family)) {
        hydrated.users.family = fitnessConfig.users.family.map(user => ({
          ...user,
          id: user.id || user.name?.toLowerCase().replace(/\s+/g, '_'),
        }));
      }

      if (Array.isArray(fitnessConfig.users.friends)) {
        hydrated.users.friends = fitnessConfig.users.friends.map(user => ({
          ...user,
          id: user.id || user.name?.toLowerCase().replace(/\s+/g, '_'),
        }));
      }
    }

    // Convert device mappings back to legacy format for backwards compatibility
    // Legacy format: ant_devices.hr = { deviceId: color }
    // New format has devices.heart_rate = { deviceId: userId } and device_colors.heart_rate = { deviceId: color }
    if (fitnessConfig.devices && fitnessConfig.device_colors) {
      hydrated.ant_devices = {
        ...fitnessConfig.ant_devices,
        hr: fitnessConfig.device_colors.heart_rate || {},
        cadence: fitnessConfig.device_colors.cadence || {},
      };
    }

    return hydrated;
  }

  /**
   * Resolve a username from a platform identity
   * @param {string} platform - Platform name (telegram, garmin, etc.)
   * @param {string} platformId - Platform user ID
   * @returns {string|null}
   */
  resolveFromPlatform(platform, platformId) {
    return this.#configService.resolveUsername(platform, platformId);
  }
}

// Singleton instance
export const userService = new UserService();

export default userService;
