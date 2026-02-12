/**
 * Admin Household Router
 *
 * CRUD API for managing household config, member profiles, and devices.
 *
 * Data sources (relative to data root):
 * - household/config/household.yml  -- household settings + user list
 * - users/{username}/profile.yml    -- per-user profiles
 * - household/config/devices.yml    -- device registry
 *
 * Endpoints (all under /api/v1/admin/household):
 * - GET    /                   - Read household config + all member profiles
 * - PUT    /                   - Update household top-level fields (name, head, apps)
 * - POST   /members            - Create new member (profile + add to users list)
 * - GET    /members/:username  - Read a specific user's profile
 * - PUT    /members/:username  - Update a user's profile
 * - DELETE /members/:username  - Remove from household users list (keep profile)
 * - GET    /devices            - List all devices
 * - POST   /devices            - Add a new device
 * - GET    /devices/:deviceId  - Read a single device
 * - PUT    /devices/:deviceId  - Update a device
 * - DELETE /devices/:deviceId  - Remove a device
 */
import express from 'express';
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';

/**
 * Validate that an identifier is safe (alphanumeric, hyphens, underscores only).
 * Prevents path traversal attacks.
 * @param {string} str
 * @returns {boolean}
 */
function isValidId(str) {
  return /^[a-zA-Z0-9_-]+$/.test(str);
}

/**
 * Create Admin Household Router
 *
 * @param {Object} config
 * @param {Object} config.configService - ConfigService for data directory paths
 * @param {Object} [config.logger=console] - Logger instance
 * @returns {express.Router}
 */
export function createAdminHouseholdRouter(config) {
  const { configService, logger = console } = config;
  const router = express.Router();

  /**
   * Get the resolved data root directory
   */
  function getDataRoot() {
    return path.resolve(configService.getDataDir());
  }

  // ---------------------------------------------------------------------------
  // Household helpers
  // ---------------------------------------------------------------------------

  /**
   * Read household config from household/config/household.yml
   * @returns {Object} Household config object
   */
  function readHousehold() {
    const absPath = path.join(getDataRoot(), 'household/config/household.yml');
    if (!fs.existsSync(absPath)) return {};
    return yaml.load(fs.readFileSync(absPath, 'utf8')) || {};
  }

  /**
   * Write household config to household/config/household.yml
   * @param {Object} data - Household config object
   */
  function writeHousehold(data) {
    const absPath = path.join(getDataRoot(), 'household/config/household.yml');
    const parentDir = path.dirname(absPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(absPath, yaml.dump(data, { indent: 2, lineWidth: -1, noRefs: true }), 'utf8');
  }

  // ---------------------------------------------------------------------------
  // Profile helpers
  // ---------------------------------------------------------------------------

  /**
   * Read a user's profile from users/{username}/profile.yml
   * @param {string} username
   * @returns {Object|null} Profile object or null if not found
   */
  function readProfile(username) {
    const absPath = path.join(getDataRoot(), `users/${username}/profile.yml`);
    if (!fs.existsSync(absPath)) return null;
    return yaml.load(fs.readFileSync(absPath, 'utf8')) || {};
  }

  /**
   * Write a user's profile to users/{username}/profile.yml
   * @param {string} username
   * @param {Object} data - Profile object
   */
  function writeProfile(username, data) {
    const dir = path.join(getDataRoot(), `users/${username}`);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const absPath = path.join(dir, 'profile.yml');
    fs.writeFileSync(absPath, yaml.dump(data, { indent: 2, lineWidth: -1, noRefs: true }), 'utf8');
  }

  // ---------------------------------------------------------------------------
  // Auth/login helpers
  // ---------------------------------------------------------------------------

  /**
   * Read a user's login data from users/{username}/auth/login.yml
   * @param {string} username
   * @returns {Object|null} Login data or null if not found
   */
  function readLoginData(username) {
    const absPath = path.join(getDataRoot(), `users/${username}/auth/login.yml`);
    if (!fs.existsSync(absPath)) return null;
    return yaml.load(fs.readFileSync(absPath, 'utf8')) || {};
  }

  // ---------------------------------------------------------------------------
  // Device helpers
  // ---------------------------------------------------------------------------

  /**
   * Read devices map from household/config/devices.yml
   * @returns {Object} Map of deviceId -> device config
   */
  function readDevices() {
    const absPath = path.join(getDataRoot(), 'household/config/devices.yml');
    if (!fs.existsSync(absPath)) return {};
    const raw = yaml.load(fs.readFileSync(absPath, 'utf8')) || {};
    return raw.devices || {};
  }

  /**
   * Write devices map to household/config/devices.yml
   * @param {Object} devices - Map of deviceId -> device config
   */
  function writeDevices(devices) {
    const absPath = path.join(getDataRoot(), 'household/config/devices.yml');
    const parentDir = path.dirname(absPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(absPath, yaml.dump({ devices }, { indent: 2, lineWidth: -1, noRefs: true }), 'utf8');
  }

  // ===========================================================================
  // GET / - Read household config + all member profiles
  // ===========================================================================

  router.get('/', (req, res) => {
    try {
      const household = readHousehold();
      const members = (household.users || []).map(username => {
        const profile = readProfile(username);
        return profile || { username, display_name: username };
      });
      logger.info?.('admin.household.read', { memberCount: members.length });
      res.json({ household, members });
    } catch (error) {
      logger.error?.('admin.household.read.failed', { error: error.message });
      res.status(500).json({ error: 'Failed to read household' });
    }
  });

  // ===========================================================================
  // PUT / - Update household top-level fields (name, head, apps)
  // ===========================================================================

  router.put('/', (req, res) => {
    try {
      const household = readHousehold();
      const { name, head, apps } = req.body || {};
      if (name !== undefined) household.name = name;
      if (head !== undefined) household.head = head;
      if (apps !== undefined) household.apps = apps;
      writeHousehold(household);
      logger.info?.('admin.household.updated');
      res.json({ ok: true, household });
    } catch (error) {
      logger.error?.('admin.household.update.failed', { error: error.message });
      res.status(500).json({ error: 'Failed to update household' });
    }
  });

  // ===========================================================================
  // POST /members - Create new member
  // ===========================================================================

  router.post('/members', (req, res) => {
    try {
      const { username, display_name, type, group, group_label, birthyear, email } = req.body || {};

      // Validate required field
      if (!username || typeof username !== 'string') {
        return res.status(400).json({ error: 'Field "username" is required and must be a string' });
      }
      if (!isValidId(username)) {
        return res.status(400).json({ error: 'Field "username" must contain only alphanumeric characters, hyphens, or underscores' });
      }

      const household = readHousehold();
      const users = household.users || [];

      // Check for duplicate
      if (users.includes(username)) {
        return res.status(409).json({ error: `Member "${username}" already exists` });
      }

      // Create profile
      const profile = {
        version: '1.0',
        username,
        household_id: household.household_id || 'default',
      };
      if (display_name !== undefined) profile.display_name = display_name;
      if (email !== undefined) profile.email = email;
      if (birthyear !== undefined) profile.birthyear = birthyear;
      if (type !== undefined) profile.type = type;
      if (group !== undefined) profile.group = group;
      if (group_label !== undefined) profile.group_label = group_label;

      writeProfile(username, profile);

      // Add to household users list
      users.push(username);
      household.users = users;
      writeHousehold(household);

      logger.info?.('admin.household.member.created', { username });
      res.status(201).json({ ok: true, member: profile });
    } catch (error) {
      logger.error?.('admin.household.member.create.failed', { error: error.message });
      res.status(500).json({ error: 'Failed to create member' });
    }
  });

  // ===========================================================================
  // GET /members/:username - Read a specific user's profile
  // ===========================================================================

  router.get('/members/:username', (req, res) => {
    try {
      const { username } = req.params;

      if (!isValidId(username)) {
        return res.status(400).json({ error: 'Invalid username format' });
      }

      const household = readHousehold();
      const users = household.users || [];
      if (!users.includes(username)) {
        return res.status(404).json({ error: `Member "${username}" not found in household` });
      }

      const profile = readProfile(username);
      if (!profile) {
        return res.status(404).json({ error: `Profile for "${username}" not found` });
      }

      // Read auth status for the member
      const loginData = readLoginData(username);
      const authStatus = {
        hasPassword: !!loginData?.password_hash,
        invitedAt: loginData?.invited_at || null,
        invitedBy: loginData?.invited_by || null,
        lastLogin: loginData?.last_login || null
      };

      logger.info?.('admin.household.member.read', { username });
      res.json({ member: profile, authStatus });
    } catch (error) {
      logger.error?.('admin.household.member.read.failed', { error: error.message });
      res.status(500).json({ error: 'Failed to read member profile' });
    }
  });

  // ===========================================================================
  // PUT /members/:username - Update a user's profile
  // ===========================================================================

  router.put('/members/:username', (req, res) => {
    try {
      const { username } = req.params;

      if (!isValidId(username)) {
        return res.status(400).json({ error: 'Invalid username format' });
      }

      const household = readHousehold();
      const users = household.users || [];
      if (!users.includes(username)) {
        return res.status(404).json({ error: `Member "${username}" not found in household` });
      }

      const profile = readProfile(username);
      if (!profile) {
        return res.status(404).json({ error: `Profile for "${username}" not found` });
      }

      // Merge body fields into existing profile, but do NOT allow changing username
      const body = req.body || {};
      const updatedProfile = { ...profile };
      for (const [key, value] of Object.entries(body)) {
        if (key === 'username') continue; // Cannot change username
        updatedProfile[key] = value;
      }

      writeProfile(username, updatedProfile);

      logger.info?.('admin.household.member.updated', { username });
      res.json({ ok: true, member: updatedProfile });
    } catch (error) {
      logger.error?.('admin.household.member.update.failed', { error: error.message });
      res.status(500).json({ error: 'Failed to update member profile' });
    }
  });

  // ===========================================================================
  // DELETE /members/:username - Remove from household users list (keep profile)
  // ===========================================================================

  router.delete('/members/:username', (req, res) => {
    try {
      const { username } = req.params;

      if (!isValidId(username)) {
        return res.status(400).json({ error: 'Invalid username format' });
      }

      const household = readHousehold();
      const users = household.users || [];
      const index = users.indexOf(username);

      if (index === -1) {
        return res.status(404).json({ error: `Member "${username}" not found in household` });
      }

      users.splice(index, 1);
      household.users = users;
      writeHousehold(household);

      logger.info?.('admin.household.member.deleted', { username });
      res.json({ ok: true, username });
    } catch (error) {
      logger.error?.('admin.household.member.delete.failed', { error: error.message });
      res.status(500).json({ error: 'Failed to remove member' });
    }
  });

  // ===========================================================================
  // GET /devices - List all devices
  // ===========================================================================

  router.get('/devices', (req, res) => {
    try {
      const devicesMap = readDevices();
      const devices = Object.entries(devicesMap).map(([id, config]) => ({ id, ...config }));
      logger.info?.('admin.household.devices.listed', { count: devices.length });
      res.json({ devices });
    } catch (error) {
      logger.error?.('admin.household.devices.list.failed', { error: error.message });
      res.status(500).json({ error: 'Failed to list devices' });
    }
  });

  // ===========================================================================
  // POST /devices - Add a new device
  // ===========================================================================

  router.post('/devices', (req, res) => {
    try {
      const { id, type, ...rest } = req.body || {};

      // Validate required fields
      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'Field "id" is required and must be a string' });
      }
      if (!isValidId(id)) {
        return res.status(400).json({ error: 'Field "id" must contain only alphanumeric characters, hyphens, or underscores' });
      }
      if (!type || typeof type !== 'string') {
        return res.status(400).json({ error: 'Field "type" is required and must be a string' });
      }

      const devicesMap = readDevices();

      // Check for duplicate
      if (devicesMap[id]) {
        return res.status(409).json({ error: `Device "${id}" already exists` });
      }

      // Build device entry (id is the key, not stored inside)
      const device = { type, ...rest };
      devicesMap[id] = device;
      writeDevices(devicesMap);

      logger.info?.('admin.household.device.created', { id, type });
      res.status(201).json({ ok: true, device: { id, ...device } });
    } catch (error) {
      logger.error?.('admin.household.device.create.failed', { error: error.message });
      res.status(500).json({ error: 'Failed to create device' });
    }
  });

  // ===========================================================================
  // GET /devices/:deviceId - Read a single device
  // ===========================================================================

  router.get('/devices/:deviceId', (req, res) => {
    try {
      const { deviceId } = req.params;

      if (!isValidId(deviceId)) {
        return res.status(400).json({ error: 'Invalid device ID format' });
      }

      const devicesMap = readDevices();

      if (!devicesMap[deviceId]) {
        return res.status(404).json({ error: `Device "${deviceId}" not found` });
      }

      logger.info?.('admin.household.device.read', { id: deviceId });
      res.json({ device: { id: deviceId, ...devicesMap[deviceId] } });
    } catch (error) {
      logger.error?.('admin.household.device.read.failed', { error: error.message });
      res.status(500).json({ error: 'Failed to read device' });
    }
  });

  // ===========================================================================
  // PUT /devices/:deviceId - Update a device
  // ===========================================================================

  router.put('/devices/:deviceId', (req, res) => {
    try {
      const { deviceId } = req.params;

      if (!isValidId(deviceId)) {
        return res.status(400).json({ error: 'Invalid device ID format' });
      }

      const devicesMap = readDevices();

      if (!devicesMap[deviceId]) {
        return res.status(404).json({ error: `Device "${deviceId}" not found` });
      }

      // Merge body into existing device; cannot change id
      const body = req.body || {};
      const updatedDevice = { ...devicesMap[deviceId] };
      for (const [key, value] of Object.entries(body)) {
        if (key === 'id') continue; // Cannot change id
        updatedDevice[key] = value;
      }

      devicesMap[deviceId] = updatedDevice;
      writeDevices(devicesMap);

      logger.info?.('admin.household.device.updated', { id: deviceId });
      res.json({ ok: true, device: { id: deviceId, ...updatedDevice } });
    } catch (error) {
      logger.error?.('admin.household.device.update.failed', { error: error.message });
      res.status(500).json({ error: 'Failed to update device' });
    }
  });

  // ===========================================================================
  // DELETE /devices/:deviceId - Remove a device
  // ===========================================================================

  router.delete('/devices/:deviceId', (req, res) => {
    try {
      const { deviceId } = req.params;

      if (!isValidId(deviceId)) {
        return res.status(400).json({ error: 'Invalid device ID format' });
      }

      const devicesMap = readDevices();

      if (!devicesMap[deviceId]) {
        return res.status(404).json({ error: `Device "${deviceId}" not found` });
      }

      delete devicesMap[deviceId];
      writeDevices(devicesMap);

      logger.info?.('admin.household.device.deleted', { id: deviceId });
      res.json({ ok: true, id: deviceId });
    } catch (error) {
      logger.error?.('admin.household.device.delete.failed', { error: error.message });
      res.status(500).json({ error: 'Failed to delete device' });
    }
  });

  return router;
}

export default createAdminHouseholdRouter;
