/**
 * HouseholdAdminService - Application service for household admin CRUD.
 *
 * Owns the persistence + business rules that the admin household router used to
 * inline: household config, per-user profiles, auth-status derivation, and the
 * device registry. The router becomes a thin HTTP shell that extracts params,
 * calls a method, and shapes the response. All error cases throw typed errors
 * (ValidationError/NotFoundError/ConflictError) that the router's P1.3 string
 * error-middleware maps to 400/404/409.
 *
 * Data sources (relative to data root):
 * - household/config/household.yml  -- household settings + user list
 * - users/{username}/profile.yml    -- per-user profiles
 * - users/{username}/auth/login.yml -- per-user login/auth data (read-only here)
 * - household/config/devices.yml    -- device registry
 */
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';
import {
  ValidationError,
  NotFoundError,
  ConflictError
} from '#system/utils/errors/index.mjs';

/**
 * Validate that an identifier is safe (alphanumeric, hyphens, underscores only).
 * Prevents path traversal attacks.
 * @param {string} str
 * @returns {boolean}
 */
function isValidId(str) {
  return /^[a-zA-Z0-9_-]+$/.test(str);
}

const YAML_DUMP_OPTS = { indent: 2, lineWidth: -1, noRefs: true };

export class HouseholdAdminService {
  /**
   * @param {Object} deps
   * @param {Object} deps.configService - ConfigService for data directory paths
   * @param {Object} [deps.logger=console] - Logger instance
   */
  constructor({ configService, logger = console }) {
    if (!configService) {
      throw new Error('HouseholdAdminService requires a configService dependency');
    }
    this.configService = configService;
    this.logger = logger;
  }

  // ---------------------------------------------------------------------------
  // Path + persistence helpers (moved verbatim from the router)
  // ---------------------------------------------------------------------------

  /** Get the resolved data root directory */
  #getDataRoot() {
    return path.resolve(this.configService.getDataDir());
  }

  /** Read household config from household/config/household.yml */
  #readHousehold() {
    const absPath = path.join(this.#getDataRoot(), 'household/config/household.yml');
    if (!fs.existsSync(absPath)) return {};
    return yaml.load(fs.readFileSync(absPath, 'utf8')) || {};
  }

  /** Write household config to household/config/household.yml */
  #writeHousehold(data) {
    const absPath = path.join(this.#getDataRoot(), 'household/config/household.yml');
    const parentDir = path.dirname(absPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(absPath, yaml.dump(data, YAML_DUMP_OPTS), 'utf8');
  }

  /** Read a user's profile from users/{username}/profile.yml */
  #readProfile(username) {
    const absPath = path.join(this.#getDataRoot(), `users/${username}/profile.yml`);
    if (!fs.existsSync(absPath)) return null;
    return yaml.load(fs.readFileSync(absPath, 'utf8')) || {};
  }

  /** Write a user's profile to users/{username}/profile.yml */
  #writeProfile(username, data) {
    const dir = path.join(this.#getDataRoot(), `users/${username}`);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const absPath = path.join(dir, 'profile.yml');
    fs.writeFileSync(absPath, yaml.dump(data, YAML_DUMP_OPTS), 'utf8');
  }

  /** Read a user's login data from users/{username}/auth/login.yml */
  #readLoginData(username) {
    const absPath = path.join(this.#getDataRoot(), `users/${username}/auth/login.yml`);
    if (!fs.existsSync(absPath)) return null;
    return yaml.load(fs.readFileSync(absPath, 'utf8')) || {};
  }

  /** Read devices map from household/config/devices.yml */
  #readDevices() {
    const absPath = path.join(this.#getDataRoot(), 'household/config/devices.yml');
    if (!fs.existsSync(absPath)) return {};
    const raw = yaml.load(fs.readFileSync(absPath, 'utf8')) || {};
    return raw.devices || {};
  }

  /** Write devices map to household/config/devices.yml */
  #writeDevices(devices) {
    const absPath = path.join(this.#getDataRoot(), 'household/config/devices.yml');
    const parentDir = path.dirname(absPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(absPath, yaml.dump({ devices }, YAML_DUMP_OPTS), 'utf8');
  }

  // ---------------------------------------------------------------------------
  // Household
  // ---------------------------------------------------------------------------

  /**
   * Read household config + all member profiles.
   * @returns {{ household: Object, members: Array<Object> }}
   */
  getHousehold() {
    const household = this.#readHousehold();
    const members = (household.users || []).map(username => {
      const profile = this.#readProfile(username);
      return profile || { username, display_name: username };
    });
    this.logger.info?.('admin.household.read', { memberCount: members.length });
    return { household, members };
  }

  /**
   * Update household top-level fields (name, head, apps).
   * @param {Object} body
   * @returns {{ household: Object }}
   */
  updateHousehold(body = {}) {
    const household = this.#readHousehold();
    const { name, head, apps } = body;
    if (name !== undefined) household.name = name;
    if (head !== undefined) household.head = head;
    if (apps !== undefined) household.apps = apps;
    this.#writeHousehold(household);
    this.logger.info?.('admin.household.updated');
    return { household };
  }

  // ---------------------------------------------------------------------------
  // Members
  // ---------------------------------------------------------------------------

  /**
   * Create a new member (profile + add to household users list).
   * @param {Object} body
   * @returns {Object} the created profile
   * @throws {ValidationError} invalid/missing username
   * @throws {ConflictError} member already exists
   */
  createMember(body = {}) {
    const { username, display_name, type, group, group_label, birthyear, email } = body;

    if (!username || typeof username !== 'string') {
      throw new ValidationError('Field "username" is required and must be a string', { field: 'username' });
    }
    if (!isValidId(username)) {
      throw new ValidationError('Field "username" must contain only alphanumeric characters, hyphens, or underscores', { field: 'username' });
    }

    const household = this.#readHousehold();
    const users = household.users || [];

    if (users.includes(username)) {
      throw new ConflictError(`Member "${username}" already exists`);
    }

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

    this.#writeProfile(username, profile);

    users.push(username);
    household.users = users;
    this.#writeHousehold(household);

    this.logger.info?.('admin.household.member.created', { username });
    return profile;
  }

  /**
   * Read a specific user's profile + auth status.
   * @param {string} username
   * @returns {{ member: Object, authStatus: Object }}
   * @throws {ValidationError} invalid username format
   * @throws {NotFoundError} member not in household / profile missing
   */
  getMember(username) {
    if (!isValidId(username)) {
      throw new ValidationError('Invalid username format', { field: 'username' });
    }

    const household = this.#readHousehold();
    const users = household.users || [];
    if (!users.includes(username)) {
      throw new NotFoundError(`Member "${username}" not found in household`);
    }

    const profile = this.#readProfile(username);
    if (!profile) {
      throw new NotFoundError(`Profile for "${username}" not found`);
    }

    const loginData = this.#readLoginData(username);
    const authStatus = {
      hasPassword: !!loginData?.password_hash,
      invitedAt: loginData?.invited_at || null,
      invitedBy: loginData?.invited_by || null,
      lastLogin: loginData?.last_login || null
    };

    this.logger.info?.('admin.household.member.read', { username });
    return { member: profile, authStatus };
  }

  /**
   * Update a user's profile (username field cannot change).
   * @param {string} username
   * @param {Object} body
   * @returns {Object} the updated profile
   * @throws {ValidationError} invalid username format
   * @throws {NotFoundError} member not in household / profile missing
   */
  updateMember(username, body = {}) {
    if (!isValidId(username)) {
      throw new ValidationError('Invalid username format', { field: 'username' });
    }

    const household = this.#readHousehold();
    const users = household.users || [];
    if (!users.includes(username)) {
      throw new NotFoundError(`Member "${username}" not found in household`);
    }

    const profile = this.#readProfile(username);
    if (!profile) {
      throw new NotFoundError(`Profile for "${username}" not found`);
    }

    const updatedProfile = { ...profile };
    for (const [key, value] of Object.entries(body)) {
      if (key === 'username') continue; // Cannot change username
      updatedProfile[key] = value;
    }

    this.#writeProfile(username, updatedProfile);

    this.logger.info?.('admin.household.member.updated', { username });
    return updatedProfile;
  }

  /**
   * Remove a member from the household users list (keeps profile on disk).
   * @param {string} username
   * @returns {{ username: string }}
   * @throws {ValidationError} invalid username format
   * @throws {NotFoundError} member not in household
   */
  deleteMember(username) {
    if (!isValidId(username)) {
      throw new ValidationError('Invalid username format', { field: 'username' });
    }

    const household = this.#readHousehold();
    const users = household.users || [];
    const index = users.indexOf(username);

    if (index === -1) {
      throw new NotFoundError(`Member "${username}" not found in household`);
    }

    users.splice(index, 1);
    household.users = users;
    this.#writeHousehold(household);

    this.logger.info?.('admin.household.member.deleted', { username });
    return { username };
  }

  // ---------------------------------------------------------------------------
  // Devices
  // ---------------------------------------------------------------------------

  /**
   * List all devices as an array of `{ id, ...config }`.
   * @returns {Array<Object>}
   */
  listDevices() {
    const devicesMap = this.#readDevices();
    const devices = Object.entries(devicesMap).map(([id, config]) => ({ id, ...config }));
    this.logger.info?.('admin.household.devices.listed', { count: devices.length });
    return devices;
  }

  /**
   * Add a new device.
   * @param {Object} body
   * @returns {Object} the created device as `{ id, ...device }`
   * @throws {ValidationError} invalid/missing id or type
   * @throws {ConflictError} device already exists
   */
  createDevice(body = {}) {
    const { id, type, ...rest } = body;

    if (!id || typeof id !== 'string') {
      throw new ValidationError('Field "id" is required and must be a string', { field: 'id' });
    }
    if (!isValidId(id)) {
      throw new ValidationError('Field "id" must contain only alphanumeric characters, hyphens, or underscores', { field: 'id' });
    }
    if (!type || typeof type !== 'string') {
      throw new ValidationError('Field "type" is required and must be a string', { field: 'type' });
    }

    const devicesMap = this.#readDevices();

    if (devicesMap[id]) {
      throw new ConflictError(`Device "${id}" already exists`);
    }

    const device = { type, ...rest };
    devicesMap[id] = device;
    this.#writeDevices(devicesMap);

    this.logger.info?.('admin.household.device.created', { id, type });
    return { id, ...device };
  }

  /**
   * Read a single device.
   * @param {string} deviceId
   * @returns {Object} `{ id, ...device }`
   * @throws {ValidationError} invalid device id format
   * @throws {NotFoundError} device not found
   */
  getDevice(deviceId) {
    if (!isValidId(deviceId)) {
      throw new ValidationError('Invalid device ID format', { field: 'deviceId' });
    }

    const devicesMap = this.#readDevices();

    if (!devicesMap[deviceId]) {
      throw new NotFoundError(`Device "${deviceId}" not found`);
    }

    this.logger.info?.('admin.household.device.read', { id: deviceId });
    return { id: deviceId, ...devicesMap[deviceId] };
  }

  /**
   * Update a device (id field cannot change).
   * @param {string} deviceId
   * @param {Object} body
   * @returns {Object} the updated device as `{ id, ...device }`
   * @throws {ValidationError} invalid device id format
   * @throws {NotFoundError} device not found
   */
  updateDevice(deviceId, body = {}) {
    if (!isValidId(deviceId)) {
      throw new ValidationError('Invalid device ID format', { field: 'deviceId' });
    }

    const devicesMap = this.#readDevices();

    if (!devicesMap[deviceId]) {
      throw new NotFoundError(`Device "${deviceId}" not found`);
    }

    const updatedDevice = { ...devicesMap[deviceId] };
    for (const [key, value] of Object.entries(body)) {
      if (key === 'id') continue; // Cannot change id
      updatedDevice[key] = value;
    }

    devicesMap[deviceId] = updatedDevice;
    this.#writeDevices(devicesMap);

    this.logger.info?.('admin.household.device.updated', { id: deviceId });
    return { id: deviceId, ...updatedDevice };
  }

  /**
   * Remove a device.
   * @param {string} deviceId
   * @returns {{ id: string }}
   * @throws {ValidationError} invalid device id format
   * @throws {NotFoundError} device not found
   */
  deleteDevice(deviceId) {
    if (!isValidId(deviceId)) {
      throw new ValidationError('Invalid device ID format', { field: 'deviceId' });
    }

    const devicesMap = this.#readDevices();

    if (!devicesMap[deviceId]) {
      throw new NotFoundError(`Device "${deviceId}" not found`);
    }

    delete devicesMap[deviceId];
    this.#writeDevices(devicesMap);

    this.logger.info?.('admin.household.device.deleted', { id: deviceId });
    return { id: deviceId };
  }
}

export default HouseholdAdminService;
