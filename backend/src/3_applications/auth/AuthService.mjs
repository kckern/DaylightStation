// backend/src/3_applications/auth/AuthService.mjs
import crypto from 'crypto';
import { hashPassword, verifyPassword } from '#system/auth/password.mjs';
import { getDefaultAuthConfig, generateJwtSecret } from '#system/auth/authConfigDefaults.mjs';

export class AuthService {
  #dataService;
  #configService;
  #logger;

  constructor({ dataService, configService, logger = console }) {
    this.#dataService = dataService;
    this.#configService = configService;
    this.#logger = logger;
  }

  needsSetup() {
    const users = this.#configService.getAllUserProfiles();
    if (users.size === 0) return true;
    for (const [username] of users) {
      const login = this.#dataService.user.read('auth/login', username);
      if (login?.password_hash) return false;
    }
    return true;
  }

  async setup({ username, password, householdName }) {
    const householdId = 'default';

    // Create user profile
    this.#dataService.user.write('profile', {
      username,
      household_id: householdId,
      roles: ['sysadmin'],
      type: 'owner',
      group: 'primary'
    }, username);

    // Create login credentials
    const passwordHash = await hashPassword(password);
    this.#dataService.user.write('auth/login', {
      password_hash: passwordHash,
      invite_token: null,
      invited_by: null,
      invited_at: null,
      last_login: new Date().toISOString()
    }, username);

    // Create household config
    this.#dataService.household.write('config/household', {
      household_id: householdId,
      name: householdName,
      head: username,
      users: [username]
    });

    // Create auth config with generated JWT secret
    const authConfig = getDefaultAuthConfig();
    authConfig.jwt.secret = generateJwtSecret();
    this.#dataService.system.write('config/auth', authConfig);

    this.#logger.info('auth.setup.complete', { username, householdId });

    return { username, roles: ['sysadmin'], householdId };
  }

  async login(username, password) {
    const profile = this.#dataService.user.read('profile', username);
    if (!profile) return null;

    const login = this.#dataService.user.read('auth/login', username);
    if (!login?.password_hash) return null;

    const valid = await verifyPassword(password, login.password_hash);
    if (!valid) return null;

    // Update last login
    this.#dataService.user.write('auth/login', {
      ...login,
      last_login: new Date().toISOString()
    }, username);

    this.#logger.info('auth.login.success', { username });

    return {
      username: profile.username,
      householdId: profile.household_id || this.#configService.getDefaultHouseholdId(),
      roles: profile.roles || []
    };
  }

  async claim(username, password) {
    if (!this.needsSetup()) {
      throw new Error('Setup already complete');
    }

    const profile = this.#dataService.user.read('profile', username);
    if (!profile) return null;

    // Ensure auth config exists (generates JWT secret if missing)
    if (!this.#dataService.system.read('config/auth')) {
      const authConfig = getDefaultAuthConfig();
      authConfig.jwt.secret = generateJwtSecret();
      this.#dataService.system.write('config/auth', authConfig);
    }

    const passwordHash = await hashPassword(password);
    this.#dataService.user.write('auth/login', {
      password_hash: passwordHash,
      invite_token: null,
      invited_by: null,
      invited_at: null,
      last_login: new Date().toISOString()
    }, username);

    this.#logger.info('auth.claim.complete', { username });

    return {
      username: profile.username,
      householdId: profile.household_id || this.#configService.getDefaultHouseholdId(),
      roles: profile.roles || []
    };
  }

  async generateInvite(username, invitedBy) {
    const profile = this.#dataService.user.read('profile', username);
    if (!profile) throw new Error(`User not found: ${username}`);

    const token = crypto.randomBytes(32).toString('hex');
    const existing = this.#dataService.user.read('auth/login', username) || {};

    this.#dataService.user.write('auth/login', {
      ...existing,
      invite_token: token,
      invited_by: invitedBy,
      invited_at: new Date().toISOString(),
      password_hash: null  // Reset password on re-invite
    }, username);

    this.#logger.info('auth.invite.generated', { username, invitedBy });

    return { token };
  }

  resolveInviteToken(token) {
    const users = this.#configService.getAllUserProfiles();
    for (const [username] of users) {
      const login = this.#dataService.user.read('auth/login', username);
      if (login?.invite_token === token) {
        const profile = this.#dataService.user.read('profile', username);
        return { username, displayName: profile?.display_name || '' };
      }
    }
    return null;
  }

  async acceptInvite(token, { password, displayName }) {
    const resolved = this.resolveInviteToken(token);
    if (!resolved) throw new Error('Invalid invite token');

    const { username } = resolved;
    const profile = this.#dataService.user.read('profile', username);
    const login = this.#dataService.user.read('auth/login', username);

    // Set password and clear invite token
    const passwordHash = await hashPassword(password);
    this.#dataService.user.write('auth/login', {
      ...login,
      password_hash: passwordHash,
      invite_token: null,
      last_login: new Date().toISOString()
    }, username);

    // Update display name if provided
    if (displayName && displayName !== profile.display_name) {
      this.#dataService.user.write('profile', {
        ...profile,
        display_name: displayName
      }, username);
    }

    this.#logger.info('auth.invite.accepted', { username });

    return {
      username,
      householdId: profile.household_id || this.#configService.getDefaultHouseholdId(),
      roles: profile.roles || []
    };
  }

  getAuthConfig() {
    return this.#dataService.system.read('config/auth');
  }
}
