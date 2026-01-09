/**
 * Config Schema Definition
 * @module lib/config/v2/configSchema
 *
 * Declares required vs optional fields for config validation.
 *
 * Structure:
 *   required: true/false - fail validation if missing
 *   type: 'string' | 'array' | 'object' | 'map'
 *   default: value to use if missing (only for required: false)
 *   properties: nested schema for objects
 *   valueSchema: schema for map values
 */

export const configSchema = {
  system: {
    required: true,
    type: 'object',
    properties: {
      dataDir: { required: true, type: 'string' },
      configDir: { required: true, type: 'string' },
      defaultHouseholdId: { required: true, type: 'string' },
      timezone: { required: false, type: 'string', default: 'America/Los_Angeles' },
    }
  },

  secrets: {
    required: true,
    type: 'object',
    properties: {
      OPENAI_API_KEY: { required: true, type: 'string' },
      TELEGRAM_NUTRIBOT_TOKEN: { required: false, type: 'string' },
      TELEGRAM_JOURNALIST_BOT_TOKEN: { required: false, type: 'string' },
    }
  },

  households: {
    required: true,
    type: 'map',
    minSize: 1,
    valueSchema: {
      head: { required: true, type: 'string' },
      users: { required: true, type: 'array' },
      timezone: { required: false, type: 'string' },
    }
  },

  users: {
    required: true,
    type: 'map',
    minSize: 1,
    // User profiles are flexible - validated only for existence
  },

  auth: {
    required: true,
    type: 'object',
    properties: {
      users: { required: false, type: 'map' },
      households: { required: false, type: 'map' },
    }
  },

  apps: {
    required: false,
    type: 'map',
  },

  identityMappings: {
    required: false,
    type: 'map',
  },
};

export default configSchema;
